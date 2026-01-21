/**
 * EDMX Metadata Parser and Cache for D365 Finance & Operations
 */

import { XMLParser } from "fast-xml-parser";
import type {
  EntitySummary,
  EntityDefinition,
  EntityField,
  EntityKey,
  NavigationProperty,
  EnumDefinition,
  EnumMember,
  MetadataCacheEntry,
} from "./types.js";
import { D365Client } from "./d365-client.js";
import { log, logError } from "./config.js";

// Cache TTL: 24 hours
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// D365 namespace prefix
const D365_NAMESPACE = "Microsoft.Dynamics.DataEntities";

/**
 * Metadata cache manager
 */
export class MetadataCache {
  private client: D365Client;
  private cache: MetadataCacheEntry | null = null;
  private loadingPromise: Promise<void> | null = null;

  // Quick entity list (fast tier)
  private entityNames: Set<string> | null = null;
  private entityNamesLoading: Promise<void> | null = null;

  constructor(client: D365Client) {
    this.client = client;
  }

  /**
   * Quick load - just entity names from root endpoint
   * Much faster than full EDMX metadata
   */
  async ensureEntityNamesLoaded(): Promise<void> {
    if (this.entityNames) return;

    // If full cache is loaded, derive entity names from it
    if (this.cache && this.cache.entities.size > 0) {
      this.entityNames = new Set(this.cache.entities.keys());
      return;
    }

    // Avoid concurrent loading
    if (this.entityNamesLoading) {
      return this.entityNamesLoading;
    }

    this.entityNamesLoading = this.loadEntityNames();
    try {
      await this.entityNamesLoading;
    } finally {
      this.entityNamesLoading = null;
    }
  }

  private async loadEntityNames(): Promise<void> {
    const startTime = Date.now();
    log("Loading D365 entity list...");

    const names = await this.client.fetchEntityList();
    this.entityNames = new Set(names);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Entity list ready: ${names.length} entities (${elapsed}s)`);
  }

  /**
   * Check if entity exists (fast, uses entity names only)
   */
  async entityExists(name: string): Promise<boolean> {
    await this.ensureEntityNamesLoaded();
    return this.entityNames?.has(name) ?? false;
  }

  /**
   * Infer basic schema from a sample record (fast path)
   */
  inferSchemaFromSample(entityName: string, sample: Record<string, unknown>): EntityDefinition {
    const fields: EntityField[] = [];

    for (const [name, value] of Object.entries(sample)) {
      // Skip OData metadata fields
      if (name.startsWith("@odata")) continue;

      fields.push({
        name,
        type: this.inferType(value),
        nullable: value === null,
        isEnum: false,
      });
    }

    return {
      name: entityName,
      description: "(Schema inferred from sample data)",
      isCustom: false,
      fields,
      keys: [],  // Can't infer keys from sample
      navigationProperties: [],  // Can't infer nav props from sample
    };
  }

  /**
   * Infer type from a sample value
   */
  private inferType(value: unknown): string {
    if (value === null) return "Unknown";
    if (typeof value === "string") {
      // Check for date patterns
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "DateTimeOffset";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}/.test(value)) return "Guid";
      return "String";
    }
    if (typeof value === "number") {
      return Number.isInteger(value) ? "Int64" : "Decimal";
    }
    if (typeof value === "boolean") return "Boolean";
    return "Unknown";
  }

  /**
   * Ensure metadata is loaded and cached
   */
  async ensureLoaded(): Promise<void> {
    // Check if cache is still valid
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return;
    }

    // Avoid concurrent loading
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this.loadMetadata();
    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * Load and parse metadata from D365
   */
  private async loadMetadata(): Promise<void> {
    log("Loading full D365 schema (this may take a while)...");
    const startTime = Date.now();

    const rawMetadata = await this.client.fetchMetadata();
    log(`Schema fetched (${(rawMetadata.length / 1024 / 1024).toFixed(1)} MB), parsing...`);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
    });

    const parsed = parser.parse(rawMetadata);
    const schemas = this.getSchemas(parsed);

    const entities = new Map<string, EntitySummary>();
    const entityDetails = new Map<string, EntityDefinition>();
    const enums = new Map<string, EnumDefinition>();

    // Parse all schemas
    for (const schema of schemas) {
      this.parseSchema(schema, entities, enums);
    }

    this.cache = {
      entities,
      entityDetails,
      enums,
      fetchedAt: Date.now(),
      rawMetadata,
    };

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Schema ready: ${entities.size} entities, ${enums.size} enums (${elapsed}s)`);

    // Schedule raw metadata cleanup after a short delay
    // This retains it long enough for immediate entity detail lookups,
    // but frees the 10-50MB memory after initial use
    setTimeout(() => {
      if (this.cache) {
        const rawSize = this.cache.rawMetadata?.length || 0;
        this.cache.rawMetadata = undefined;
        if (rawSize > 0) {
          log(`Cleared raw metadata cache (${(rawSize / 1024 / 1024).toFixed(1)} MB freed)`);
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Get schemas from parsed EDMX
   */
  private getSchemas(parsed: unknown): unknown[] {
    const edmx = (parsed as Record<string, unknown>)["Edmx"];
    if (!edmx) return [];

    const dataServices = (edmx as Record<string, unknown>)["DataServices"];
    if (!dataServices) return [];

    const schemas = (dataServices as Record<string, unknown>)["Schema"];
    if (!schemas) return [];

    return Array.isArray(schemas) ? schemas : [schemas];
  }

  /**
   * Parse a schema element for entities and enums
   */
  private parseSchema(
    schema: unknown,
    entities: Map<string, EntitySummary>,
    enums: Map<string, EnumDefinition>
  ): void {
    const schemaObj = schema as Record<string, unknown>;
    const namespace = (schemaObj["@_Namespace"] as string) || "";

    // Parse EntityTypes
    const entityTypes = schemaObj["EntityType"];
    if (entityTypes) {
      const entityArray = Array.isArray(entityTypes) ? entityTypes : [entityTypes];
      for (const entityType of entityArray) {
        const entity = this.parseEntitySummary(entityType, namespace);
        if (entity) {
          entities.set(entity.name, entity);
        }
      }
    }

    // Parse EnumTypes
    const enumTypes = schemaObj["EnumType"];
    if (enumTypes) {
      const enumArray = Array.isArray(enumTypes) ? enumTypes : [enumTypes];
      for (const enumType of enumArray) {
        const enumDef = this.parseEnumType(enumType, namespace);
        if (enumDef) {
          enums.set(enumDef.name, enumDef);
          // Also index by full name
          enums.set(enumDef.fullName, enumDef);
        }
      }
    }
  }

  /**
   * Parse an EntityType element into a summary
   */
  private parseEntitySummary(entityType: unknown, namespace: string): EntitySummary | null {
    const entityObj = entityType as Record<string, unknown>;
    const name = entityObj["@_Name"] as string;
    if (!name) return null;

    // Check for description annotation
    let description: string | undefined;
    const annotation = entityObj["Annotation"];
    if (annotation) {
      const annotations = Array.isArray(annotation) ? annotation : [annotation];
      for (const ann of annotations) {
        const annObj = ann as Record<string, unknown>;
        if (annObj["@_Term"]?.toString().includes("Description")) {
          description = annObj["@_String"] as string;
          break;
        }
      }
    }

    // Determine if custom (not in Microsoft.Dynamics.DataEntities namespace or has specific markers)
    const isCustom = !namespace.startsWith("Microsoft.Dynamics");

    return {
      name,
      description,
      isCustom,
    };
  }

  /**
   * Parse an EnumType element
   */
  private parseEnumType(enumType: unknown, namespace: string): EnumDefinition | null {
    const enumObj = enumType as Record<string, unknown>;
    const name = enumObj["@_Name"] as string;
    if (!name) return null;

    const members: EnumMember[] = [];
    const memberElements = enumObj["Member"];
    if (memberElements) {
      const memberArray = Array.isArray(memberElements) ? memberElements : [memberElements];
      for (const member of memberArray) {
        const memberObj = member as Record<string, unknown>;
        const memberName = memberObj["@_Name"] as string;
        const memberValue = parseInt(memberObj["@_Value"] as string, 10);
        if (memberName !== undefined) {
          members.push({
            name: memberName,
            value: isNaN(memberValue) ? members.length : memberValue,
          });
        }
      }
    }

    return {
      name,
      fullName: namespace ? `${namespace}.${name}` : name,
      members,
    };
  }

  /**
   * List entities matching a pattern
   */
  async listEntities(pattern?: string): Promise<EntitySummary[]> {
    await this.ensureLoaded();
    if (!this.cache) throw new Error("Metadata not loaded");

    let results = Array.from(this.cache.entities.values());

    if (pattern) {
      const regex = this.patternToRegex(pattern);
      results = results.filter((e) => regex.test(e.name));
    }

    // Sort by name
    results.sort((a, b) => a.name.localeCompare(b.name));

    return results;
  }

  /**
   * Get detailed entity definition
   * Uses tiered loading for fast response times:
   * 1. If full cache loaded, use it (has complete schema)
   * 2. Fast path: infer schema from sample query (~2s)
   * 3. Fallback: load full metadata (slow, may timeout)
   */
  async getEntityDefinition(entityName: string): Promise<EntityDefinition | null> {
    // If full cache is loaded, use it (has complete schema)
    if (this.cache) {
      return this.getEntityFromCache(entityName, this.cache);
    }

    // Fast tier: check if entity exists
    const exists = await this.entityExists(entityName);
    if (!exists) {
      return null;
    }

    // Fast path: infer schema from sample query (~2s)
    const sample = await this.client.fetchEntitySample(entityName);
    if (sample) {
      return this.inferSchemaFromSample(entityName, sample);
    }

    // Entity exists but has no data - return minimal definition
    // Don't fall back to slow metadata load as it may timeout
    return {
      name: entityName,
      description: "(Entity exists but has no data. Cannot infer schema.)",
      isCustom: false,
      fields: [],
      keys: [],
      navigationProperties: [],
    };
  }

  /**
   * Get entity definition from loaded cache
   */
  private getEntityFromCache(entityName: string, cache: MetadataCacheEntry): EntityDefinition | null {
    // Check if already parsed in detail
    if (cache.entityDetails.has(entityName)) {
      return cache.entityDetails.get(entityName)!;
    }

    // Check if entity exists in cache
    const summary = cache.entities.get(entityName);
    if (!summary) {
      return null;
    }

    // Parse detailed definition from raw metadata
    const definition = this.parseEntityDefinition(entityName);
    if (definition) {
      cache.entityDetails.set(entityName, definition);
    }

    return definition;
  }

  /**
   * Parse detailed entity definition from raw metadata
   */
  private parseEntityDefinition(entityName: string): EntityDefinition | null {
    if (!this.cache?.rawMetadata) return null;

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
    });

    const parsed = parser.parse(this.cache.rawMetadata);
    const schemas = this.getSchemas(parsed);

    for (const schema of schemas) {
      const schemaObj = schema as Record<string, unknown>;
      const namespace = (schemaObj["@_Namespace"] as string) || "";

      const entityTypes = schemaObj["EntityType"];
      if (!entityTypes) continue;

      const entityArray = Array.isArray(entityTypes) ? entityTypes : [entityTypes];
      for (const entityType of entityArray) {
        const entityObj = entityType as Record<string, unknown>;
        if (entityObj["@_Name"] === entityName) {
          return this.parseFullEntityType(entityObj, namespace);
        }
      }
    }

    return null;
  }

  /**
   * Parse a full EntityType element with all details
   */
  private parseFullEntityType(entityObj: Record<string, unknown>, namespace: string): EntityDefinition {
    const name = entityObj["@_Name"] as string;

    // Get description
    let description: string | undefined;
    const annotation = entityObj["Annotation"];
    if (annotation) {
      const annotations = Array.isArray(annotation) ? annotation : [annotation];
      for (const ann of annotations) {
        const annObj = ann as Record<string, unknown>;
        if (annObj["@_Term"]?.toString().includes("Description")) {
          description = annObj["@_String"] as string;
          break;
        }
      }
    }

    // Parse keys
    const keys: EntityKey[] = [];
    const keyElement = entityObj["Key"];
    if (keyElement) {
      const keyObj = keyElement as Record<string, unknown>;
      const propertyRefs = keyObj["PropertyRef"];
      if (propertyRefs) {
        const refArray = Array.isArray(propertyRefs) ? propertyRefs : [propertyRefs];
        keys.push({
          name: "PrimaryKey",
          fields: refArray.map((ref) => (ref as Record<string, unknown>)["@_Name"] as string),
        });
      }
    }

    // Parse properties (fields)
    const fields: EntityField[] = [];
    const properties = entityObj["Property"];
    if (properties) {
      const propArray = Array.isArray(properties) ? properties : [properties];
      for (const prop of propArray) {
        const field = this.parseProperty(prop);
        if (field) {
          fields.push(field);
        }
      }
    }

    // Parse navigation properties
    const navigationProperties: NavigationProperty[] = [];
    const navProps = entityObj["NavigationProperty"];
    if (navProps) {
      const navArray = Array.isArray(navProps) ? navProps : [navProps];
      for (const nav of navArray) {
        const navProp = this.parseNavigationProperty(nav);
        if (navProp) {
          navigationProperties.push(navProp);
        }
      }
    }

    const isCustom = !namespace.startsWith("Microsoft.Dynamics");

    return {
      name,
      description,
      isCustom,
      fields,
      keys,
      navigationProperties,
    };
  }

  /**
   * Parse a Property element into an EntityField
   */
  private parseProperty(prop: unknown): EntityField | null {
    const propObj = prop as Record<string, unknown>;
    const name = propObj["@_Name"] as string;
    const type = propObj["@_Type"] as string;
    if (!name || !type) return null;

    const nullable = propObj["@_Nullable"] !== "false";
    const maxLength = propObj["@_MaxLength"]
      ? parseInt(propObj["@_MaxLength"] as string, 10)
      : undefined;
    const precision = propObj["@_Precision"]
      ? parseInt(propObj["@_Precision"] as string, 10)
      : undefined;
    const scale = propObj["@_Scale"]
      ? parseInt(propObj["@_Scale"] as string, 10)
      : undefined;

    // Check if enum type
    const isEnum = type.includes(".") && !type.startsWith("Edm.");
    const enumTypeName = isEnum ? type : undefined;

    // Simplify type name
    let simpleType = type;
    if (type.startsWith("Edm.")) {
      simpleType = type.substring(4);
    } else if (isEnum) {
      // Extract just the enum name from full namespace
      const parts = type.split(".");
      simpleType = parts[parts.length - 1];
    }

    return {
      name,
      type: simpleType,
      nullable,
      maxLength,
      precision,
      scale,
      isEnum,
      enumTypeName,
    };
  }

  /**
   * Parse a NavigationProperty element
   */
  private parseNavigationProperty(nav: unknown): NavigationProperty | null {
    const navObj = nav as Record<string, unknown>;
    const name = navObj["@_Name"] as string;
    const type = navObj["@_Type"] as string;
    if (!name || !type) return null;

    // Check if collection
    const isCollection = type.startsWith("Collection(");
    let targetType = type;
    if (isCollection) {
      targetType = type.slice(11, -1); // Remove "Collection(" and ")"
    }

    // Extract entity name from type
    const parts = targetType.split(".");
    const targetEntity = parts[parts.length - 1];

    return {
      name,
      type: targetType,
      isCollection,
      targetEntity,
    };
  }

  /**
   * Get enum definition by name
   */
  async getEnumDefinition(enumName: string): Promise<EnumDefinition | null> {
    await this.ensureLoaded();
    if (!this.cache) throw new Error("Metadata not loaded");

    // Try exact match first
    if (this.cache.enums.has(enumName)) {
      return this.cache.enums.get(enumName)!;
    }

    // Try with D365 namespace prefix
    const fullName = `${D365_NAMESPACE}.${enumName}`;
    if (this.cache.enums.has(fullName)) {
      return this.cache.enums.get(fullName)!;
    }

    // Search by partial name (case-insensitive)
    const lowerName = enumName.toLowerCase();
    for (const [key, value] of this.cache.enums) {
      if (key.toLowerCase().endsWith(lowerName) || key.toLowerCase() === lowerName) {
        return value;
      }
    }

    return null;
  }

  /**
   * List all unique enum definitions
   */
  async listEnums(): Promise<EnumDefinition[]> {
    await this.ensureLoaded();
    if (!this.cache) throw new Error("Metadata not loaded");

    const seen = new Set<string>();
    const enums: EnumDefinition[] = [];

    for (const [, enumDef] of this.cache.enums) {
      if (!seen.has(enumDef.fullName)) {
        seen.add(enumDef.fullName);
        enums.push(enumDef);
      }
    }

    return enums.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Convert wildcard pattern to regex
   * Supports * (any characters) and ? (single character)
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
      .replace(/\*/g, ".*") // * -> .*
      .replace(/\?/g, "."); // ? -> .

    return new RegExp(`^${escaped}$`, "i");
  }

  /**
   * Invalidate cache (force reload on next access)
   */
  invalidateCache(): void {
    this.cache = null;
    log("Metadata cache invalidated");
  }
}
