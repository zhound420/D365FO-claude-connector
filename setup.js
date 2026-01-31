#!/usr/bin/env node

/**
 * D365 MCP Server - Interactive Setup Script
 *
 * This script guides users through the complete configuration process:
 * 1. Prerequisites check (Node.js, dependencies, build)
 * 2. Environment configuration collection
 * 3. Connectivity testing
 * 4. Configuration file generation
 * 5. Claude Desktop/Code integration
 */

import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

// ============================================================================
// Utility Functions
// ============================================================================

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function printHeader() {
  console.log(`
${colors.cyan}${colors.bold}+----------------------------------------------------------+
|       D365 MCP Server - Interactive Setup                |
+----------------------------------------------------------+${colors.reset}
`);
}

function printSuccess(message) {
  console.log(`  ${colors.green}\u2713${colors.reset} ${message}`);
}

function printError(message) {
  console.log(`  ${colors.red}\u2717${colors.reset} ${message}`);
}

function printWarning(message) {
  console.log(`  ${colors.yellow}!${colors.reset} ${message}`);
}

function printInfo(message) {
  console.log(`  ${colors.blue}i${colors.reset} ${message}`);
}

function printStep(step, total, message) {
  console.log(`\n${colors.cyan}[${step}/${total}]${colors.reset} ${colors.bold}${message}${colors.reset}\n`);
}

function isValidGuid(value) {
  const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return guidRegex.test(value);
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('.');
  } catch {
    return false;
  }
}

function isPlaceholderValue(value) {
  const placeholders = [
    'your-tenant-id',
    'your-client-id',
    'your-client-secret',
    'your-environment-url',
    'xxxxxxxx',
    'placeholder',
    'example',
    '<tenant',
    '<client',
    '<secret',
    '<url',
  ];
  const lowerValue = value.toLowerCase();
  return placeholders.some(p => lowerValue.includes(p));
}

function getClaudeDesktopConfigPath() {
  const plat = platform();
  if (plat === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (plat === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  } else {
    return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
  }
}

function getClaudeCodeConfigPath() {
  return join(homedir(), '.claude', 'settings.json');
}

function ensureDirectoryExists(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function promptWithOptions(rl, question, options) {
  console.log(`${colors.bold}${question}${colors.reset}`);
  options.forEach((opt, i) => {
    console.log(`  ${colors.cyan}${i + 1}${colors.reset}) ${opt.label}${opt.description ? ` ${colors.dim}(${opt.description})${colors.reset}` : ''}`);
  });

  while (true) {
    const answer = await rl.question(`${colors.dim}Enter choice [1-${options.length}]: ${colors.reset}`);
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= options.length) {
      return options[num - 1].value;
    }
    console.log(`${colors.red}Please enter a number between 1 and ${options.length}${colors.reset}`);
  }
}

async function promptYesNo(rl, question, defaultYes = true) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await rl.question(`${colors.bold}${question}${colors.reset} ${colors.dim}${hint}: ${colors.reset}`);
  if (answer === '') return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

async function promptRequired(rl, question, validator, errorMessage) {
  while (true) {
    const answer = await rl.question(`${colors.bold}${question}:${colors.reset} `);
    if (answer.trim() === '') {
      console.log(`${colors.red}This field is required${colors.reset}`);
      continue;
    }
    if (isPlaceholderValue(answer)) {
      console.log(`${colors.red}Please enter a real value, not a placeholder${colors.reset}`);
      continue;
    }
    if (validator && !validator(answer)) {
      console.log(`${colors.red}${errorMessage}${colors.reset}`);
      continue;
    }
    return answer.trim();
  }
}

async function promptSecret(rl, question) {
  // We can't truly hide input with readline, but we'll warn the user
  console.log(`${colors.dim}(Note: Input will be visible - clear terminal after setup)${colors.reset}`);
  while (true) {
    const answer = await rl.question(`${colors.bold}${question}:${colors.reset} `);
    if (answer.trim() === '') {
      console.log(`${colors.red}This field is required${colors.reset}`);
      continue;
    }
    if (isPlaceholderValue(answer)) {
      console.log(`${colors.red}Please enter a real value, not a placeholder${colors.reset}`);
      continue;
    }
    return answer.trim();
  }
}

// ============================================================================
// Prerequisites Check
// ============================================================================

async function checkPrerequisites(rl) {
  printStep(1, 6, 'Checking Prerequisites');

  let allGood = true;

  // Check Node.js version
  const nodeVersion = process.version;
  const versionMatch = nodeVersion.match(/^v(\d+)\.(\d+)/);
  const majorVersion = versionMatch ? parseInt(versionMatch[1], 10) : 0;

  if (majorVersion >= 18) {
    printSuccess(`Node.js ${nodeVersion} (>= 18.0.0 required)`);
  } else {
    printError(`Node.js ${nodeVersion} - version 18.0.0 or higher required`);
    allGood = false;
  }

  // Check if node_modules exists
  const nodeModulesPath = join(__dirname, 'node_modules');
  if (existsSync(nodeModulesPath)) {
    printSuccess('Dependencies installed');
  } else {
    printWarning('Dependencies not installed');
    if (await promptYesNo(rl, 'Run npm install now?')) {
      console.log('\n  Installing dependencies...');
      try {
        execSync('npm install', { cwd: __dirname, stdio: 'inherit' });
        printSuccess('Dependencies installed');
      } catch (e) {
        printError('Failed to install dependencies');
        allGood = false;
      }
    } else {
      printInfo('Run "npm install" before using the server');
      allGood = false;
    }
  }

  // Check if dist/index.js exists
  const distPath = join(__dirname, 'dist', 'index.js');
  if (existsSync(distPath)) {
    printSuccess('Project built');
  } else {
    printWarning('Project not built');
    if (await promptYesNo(rl, 'Run npm run build now?')) {
      console.log('\n  Building project...');
      try {
        execSync('npm run build', { cwd: __dirname, stdio: 'inherit' });
        printSuccess('Project built');
      } catch (e) {
        printError('Failed to build project');
        allGood = false;
      }
    } else {
      printInfo('Run "npm run build" before using the server');
      allGood = false;
    }
  }

  if (!allGood) {
    console.log(`\n${colors.yellow}Some prerequisites are missing. You can continue setup, but the server may not work until they're resolved.${colors.reset}`);
    if (!await promptYesNo(rl, 'Continue anyway?', false)) {
      console.log('\nSetup cancelled. Please resolve the issues and run setup again.');
      process.exit(1);
    }
  }

  return allGood;
}

// ============================================================================
// Environment Configuration Collection
// ============================================================================

async function collectEnvironment(rl, existingNames = []) {
  console.log('');

  // Name
  let name;
  while (true) {
    name = await promptRequired(
      rl,
      'Environment name (e.g., production, uat, dev)',
      (v) => /^[a-z0-9-]+$/i.test(v),
      'Use only letters, numbers, and hyphens'
    );
    name = name.toLowerCase();
    if (existingNames.includes(name)) {
      console.log(`${colors.red}An environment named "${name}" already exists${colors.reset}`);
      continue;
    }
    break;
  }

  // Display name
  const displayName = await promptRequired(
    rl,
    'Display name (human-readable)',
    null,
    null
  );

  // Type
  const envType = await promptWithOptions(rl, 'Environment type:', [
    { label: 'production', value: 'production', description: 'read-only' },
    { label: 'non-production', value: 'non-production', description: 'read/write enabled' },
  ]);

  // Tenant ID
  const tenantId = await promptRequired(
    rl,
    'Azure AD Tenant ID (GUID)',
    isValidGuid,
    'Please enter a valid GUID (e.g., xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)'
  );

  // Client ID
  const clientId = await promptRequired(
    rl,
    'Azure AD Client ID (GUID)',
    isValidGuid,
    'Please enter a valid GUID (e.g., xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)'
  );

  // Client Secret
  const clientSecret = await promptSecret(rl, 'Azure AD Client Secret');

  // Environment URL
  let environmentUrl = await promptRequired(
    rl,
    'D365 Environment URL (e.g., https://contoso.operations.dynamics.com)',
    isValidUrl,
    'Please enter a valid HTTPS URL'
  );
  // Remove trailing slash
  environmentUrl = environmentUrl.replace(/\/+$/, '');

  return {
    name,
    displayName,
    type: envType,
    tenantId,
    clientId,
    clientSecret,
    environmentUrl,
  };
}

async function collectAllEnvironments(rl) {
  printStep(2, 6, 'Configure D365 Environments');

  const configType = await promptWithOptions(rl, 'How would you like to configure D365 environments?', [
    { label: 'Multi-environment JSON file', value: 'json', description: 'recommended' },
    { label: 'Single environment via environment variables', value: 'env', description: 'legacy' },
  ]);

  if (configType === 'env') {
    console.log(`
${colors.yellow}Environment variable configuration is a legacy option.${colors.reset}

Set the following environment variables:
  - D365_TENANT_ID
  - D365_CLIENT_ID
  - D365_CLIENT_SECRET
  - D365_ENVIRONMENT_URL
  - D365_ENVIRONMENT_TYPE (optional: "production" or "non-production")

Then restart the MCP server.
`);
    if (!await promptYesNo(rl, 'Would you like to configure multi-environment JSON instead?')) {
      return null;
    }
  }

  const environments = [];
  let addMore = true;

  while (addMore) {
    const env = await collectEnvironment(rl, environments.map(e => e.name));
    environments.push(env);

    console.log('');
    addMore = await promptYesNo(rl, 'Add another environment?', environments.length < 2);
  }

  // Set default environment
  if (environments.length === 1) {
    environments[0].default = true;
  } else {
    console.log('\n' + colors.bold + 'Select the default environment:' + colors.reset);
    const options = environments.map((e, i) => ({
      label: e.displayName,
      value: i,
      description: e.name,
    }));
    const defaultIndex = await promptWithOptions(rl, '', options);
    environments[defaultIndex].default = true;
  }

  return { environments };
}

// ============================================================================
// Connectivity Testing
// ============================================================================

async function testConnectivity(env) {
  try {
    // Get OAuth2 token
    const tokenUrl = `https://login.microsoftonline.com/${env.tenantId}/oauth2/token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.clientId,
        client_secret: env.clientSecret,
        resource: env.environmentUrl,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}));
      const errorDesc = errorData.error_description || errorData.error || 'Unknown error';
      return { success: false, error: `Authentication failed: ${errorDesc}` };
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Test D365 OData endpoint
    const dataUrl = `${env.environmentUrl}/data/`;
    const dataResponse = await fetch(dataUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!dataResponse.ok) {
      return { success: false, error: `D365 API error: HTTP ${dataResponse.status}` };
    }

    const data = await dataResponse.json();
    const entityCount = data.value ? data.value.length : 0;

    return { success: true, entityCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function testAllConnectivity(rl, config) {
  printStep(3, 6, 'Testing Connectivity');

  const results = [];

  for (const env of config.environments) {
    process.stdout.write(`  Testing ${env.displayName}... `);
    const result = await testConnectivity(env);
    results.push({ env, ...result });

    if (result.success) {
      console.log(`${colors.green}\u2713 Connected${colors.reset} ${colors.dim}(${result.entityCount} entities)${colors.reset}`);
    } else {
      console.log(`${colors.red}\u2717 Failed${colors.reset}`);
      console.log(`    ${colors.dim}${result.error}${colors.reset}`);
    }
  }

  const failures = results.filter(r => !r.success);

  if (failures.length > 0) {
    console.log('');
    for (const failure of failures) {
      const action = await promptWithOptions(
        rl,
        `${failure.env.displayName} failed. What would you like to do?`,
        [
          { label: 'Re-enter credentials', value: 'retry' },
          { label: 'Continue anyway', value: 'continue', description: 'fix later' },
          { label: 'Remove from configuration', value: 'remove' },
        ]
      );

      if (action === 'retry') {
        // Remove the failed env and recollect
        const index = config.environments.indexOf(failure.env);
        console.log(`\nRe-enter credentials for ${failure.env.name}:`);
        const existingNames = config.environments.filter((_, i) => i !== index).map(e => e.name);
        const newEnv = await collectEnvironment(rl, existingNames);
        newEnv.default = failure.env.default;
        config.environments[index] = newEnv;

        // Test again
        process.stdout.write(`  Testing ${newEnv.displayName}... `);
        const retryResult = await testConnectivity(newEnv);
        if (retryResult.success) {
          console.log(`${colors.green}\u2713 Connected${colors.reset} ${colors.dim}(${retryResult.entityCount} entities)${colors.reset}`);
        } else {
          console.log(`${colors.red}\u2717 Failed${colors.reset}`);
          console.log(`    ${colors.dim}${retryResult.error}${colors.reset}`);
        }
      } else if (action === 'remove') {
        const index = config.environments.indexOf(failure.env);
        const wasDefault = failure.env.default;
        config.environments.splice(index, 1);

        // If removed env was default, set new default
        if (wasDefault && config.environments.length > 0) {
          config.environments[0].default = true;
          console.log(`  ${colors.yellow}${config.environments[0].displayName} is now the default environment${colors.reset}`);
        }
      }
    }
  }

  if (config.environments.length === 0) {
    console.log(`\n${colors.red}No environments configured. Setup cannot continue.${colors.reset}`);
    process.exit(1);
  }

  return config;
}

// ============================================================================
// Configuration File Writing
// ============================================================================

async function writeConfigFile(rl, config) {
  printStep(4, 6, 'Saving Configuration');

  const configPath = join(__dirname, 'd365-environments.json');

  // Check if file exists
  if (existsSync(configPath)) {
    printWarning('d365-environments.json already exists');
    if (!await promptYesNo(rl, 'Overwrite existing configuration?')) {
      console.log('Configuration not saved.');
      return false;
    }
  }

  // Write config file
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  printSuccess(`Configuration saved to: ${configPath}`);

  // Add to .gitignore if not present
  const gitignorePath = join(__dirname, '.gitignore');
  if (existsSync(gitignorePath)) {
    const gitignoreContent = readFileSync(gitignorePath, 'utf-8');
    if (!gitignoreContent.includes('d365-environments.json')) {
      writeFileSync(gitignorePath, gitignoreContent + '\n# D365 configuration (contains secrets)\nd365-environments.json\n');
      printSuccess('Added d365-environments.json to .gitignore');
    } else {
      printInfo('d365-environments.json already in .gitignore');
    }
  } else {
    writeFileSync(gitignorePath, '# D365 configuration (contains secrets)\nd365-environments.json\n');
    printSuccess('Created .gitignore with d365-environments.json');
  }

  console.log(`\n${colors.yellow}! Important: Never commit d365-environments.json to version control - it contains secrets!${colors.reset}`);

  return true;
}

// ============================================================================
// Claude Integration
// ============================================================================

/**
 * Generate multi-server MCP config with separate server per environment
 * This allows users to see environment indicators in Claude's sidebar
 */
function generateMultiServerConfig(envConfig, serverPath, configPath) {
  const servers = {};
  for (const env of envConfig.environments) {
    // Use simple name without emojis (emojis break Claude Desktop)
    const serverKey = `D365-${env.name}`;
    servers[serverKey] = {
      command: 'node',
      args: [serverPath],
      env: {
        D365_CONFIG_FILE: configPath,
        D365_SINGLE_ENV: env.name
      }
    };
  }
  return servers;
}

/**
 * Generate single server MCP config (multi-environment mode)
 */
function generateSingleServerConfig(serverPath, configPath) {
  return {
    'd365': {
      command: 'node',
      args: [serverPath],
      env: {
        D365_CONFIG_FILE: configPath
      }
    }
  };
}

async function configureClaudeIntegration(rl, envConfig) {
  printStep(5, 6, 'Claude Integration');

  const serverPath = join(__dirname, 'dist', 'index.js');
  const configPath = join(__dirname, 'd365-environments.json');

  const integrationChoice = await promptWithOptions(
    rl,
    'Configure Claude integration?',
    [
      { label: 'Claude Desktop', value: 'desktop' },
      { label: 'Claude Code CLI', value: 'cli' },
      { label: 'Both', value: 'both' },
      { label: 'Skip', value: 'skip', description: 'configure manually later' },
    ]
  );

  if (integrationChoice === 'skip') {
    printInfo('Skipping Claude integration configuration');
    return;
  }

  // Ask about server configuration mode if multiple environments
  // Default to separate servers (recommended for clear visibility)
  let serverMode = 'multi';
  if (envConfig && envConfig.environments && envConfig.environments.length > 1) {
    console.log(`\n${colors.cyan}Environment Visibility Configuration${colors.reset}`);
    console.log(`${colors.dim}Separate servers show each environment in Claude's sidebar with visual indicators.${colors.reset}`);
    console.log(`${colors.dim}Single server requires specifying environment in queries (advanced).${colors.reset}\n`);

    const useSeparateServers = await promptYesNo(
      rl,
      'Use separate MCP servers per environment? (Recommended)',
      true  // default to yes
    );

    if (!useSeparateServers) {
      serverMode = 'single';
      console.log(`\n${colors.yellow}Tip: Use the 'set_environment' tool to set your working environment for the session.${colors.reset}`);
    }
  }

  const mcpServers = serverMode === 'multi' && envConfig
    ? generateMultiServerConfig(envConfig, serverPath, configPath)
    : generateSingleServerConfig(serverPath, configPath);

  // Configure Claude Desktop
  if (integrationChoice === 'desktop' || integrationChoice === 'both') {
    const desktopPath = getClaudeDesktopConfigPath();

    try {
      let config = {};
      if (existsSync(desktopPath)) {
        const content = readFileSync(desktopPath, 'utf-8');
        config = JSON.parse(content);
      }

      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      // Check for existing D365 servers and remove them
      const existingD365Keys = Object.keys(config.mcpServers).filter(
        k => k === 'd365' || k.startsWith('D365 ') || k.startsWith('D365-')
      );
      if (existingD365Keys.length > 0) {
        printWarning(`Found existing D365 server(s): ${existingD365Keys.join(', ')}`);
        if (await promptYesNo(rl, 'Remove existing D365 servers and add new configuration?')) {
          for (const key of existingD365Keys) {
            delete config.mcpServers[key];
          }
        } else {
          printInfo('Keeping existing configuration');
          // Don't add new servers
          return;
        }
      }

      // Add new server(s)
      Object.assign(config.mcpServers, mcpServers);

      ensureDirectoryExists(desktopPath);
      writeFileSync(desktopPath, JSON.stringify(config, null, 2) + '\n');

      const serverCount = Object.keys(mcpServers).length;
      if (serverCount === 1) {
        printSuccess(`Updated: ${desktopPath} (single server)`);
      } else {
        printSuccess(`Updated: ${desktopPath} (${serverCount} servers)`);
        console.log(`${colors.dim}  Servers added:${colors.reset}`);
        for (const key of Object.keys(mcpServers)) {
          console.log(`${colors.dim}    - ${key}${colors.reset}`);
        }
      }
    } catch (error) {
      printError(`Failed to configure Claude Desktop: ${error.message}`);
    }
  }

  // Configure Claude Code CLI
  if (integrationChoice === 'cli' || integrationChoice === 'both') {
    const cliPath = getClaudeCodeConfigPath();

    try {
      let config = {};
      if (existsSync(cliPath)) {
        const content = readFileSync(cliPath, 'utf-8');
        config = JSON.parse(content);
      }

      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      // Check for existing D365 servers and remove them
      const existingD365Keys = Object.keys(config.mcpServers).filter(
        k => k === 'd365' || k.startsWith('D365 ') || k.startsWith('D365-')
      );
      if (existingD365Keys.length > 0) {
        printWarning(`Found existing D365 server(s): ${existingD365Keys.join(', ')}`);
        if (await promptYesNo(rl, 'Remove existing D365 servers and add new configuration?')) {
          for (const key of existingD365Keys) {
            delete config.mcpServers[key];
          }
        } else {
          printInfo('Keeping existing configuration');
          return;
        }
      }

      // Add new server(s)
      Object.assign(config.mcpServers, mcpServers);

      ensureDirectoryExists(cliPath);
      writeFileSync(cliPath, JSON.stringify(config, null, 2) + '\n');

      const serverCount = Object.keys(mcpServers).length;
      if (serverCount === 1) {
        printSuccess(`Updated: ${cliPath} (single server)`);
      } else {
        printSuccess(`Updated: ${cliPath} (${serverCount} servers)`);
      }
    } catch (error) {
      printError(`Failed to configure Claude Code CLI: ${error.message}`);
    }
  }

  const plat = platform();
  if (integrationChoice !== 'skip') {
    console.log(`\n${colors.cyan}Restart Instructions:${colors.reset}`);
    if (integrationChoice === 'desktop' || integrationChoice === 'both') {
      if (plat === 'darwin') {
        console.log('  Claude Desktop: Quit and reopen the app, or press Cmd+R');
      } else if (plat === 'win32') {
        console.log('  Claude Desktop: Quit and reopen the app, or press Ctrl+R');
      } else {
        console.log('  Claude Desktop: Quit and reopen the app');
      }
    }
    if (integrationChoice === 'cli' || integrationChoice === 'both') {
      console.log('  Claude Code CLI: Start a new session');
    }

    if (serverMode === 'multi') {
      console.log(`\n${colors.cyan}MCP Servers Created:${colors.reset}`);
      for (const env of envConfig.environments) {
        const typeLabel = env.type === 'production' ? 'read-only' : 'read/write';
        console.log(`  - D365-${env.name} (${typeLabel})`);
      }
    }
  }
}

// ============================================================================
// Summary
// ============================================================================

function printSummary(config) {
  printStep(6, 6, 'Setup Complete!');

  console.log(`${colors.cyan}${colors.bold}+----------------------------------------------------------+
|                    Setup Complete!                        |
+----------------------------------------------------------+${colors.reset}
`);

  console.log(`${colors.bold}Configured environments:${colors.reset}`);
  for (const env of config.environments) {
    const defaultTag = env.default ? ` ${colors.green}(default)${colors.reset}` : '';
    const typeTag = env.type === 'production' ? `${colors.yellow}read-only${colors.reset}` : `${colors.green}read/write${colors.reset}`;
    console.log(`  - ${colors.bold}${env.displayName}${colors.reset}${defaultTag} [${typeTag}]`);
    console.log(`    ${colors.dim}${env.environmentUrl}${colors.reset}`);
  }

  console.log(`
${colors.bold}Next steps:${colors.reset}
  1. Restart Claude Desktop to load the MCP server
  2. Ask Claude: "List the D365 entities available"
  3. Try: "Query the top 5 customers from D365"

${colors.bold}Useful commands:${colors.reset}
  npm start       - Run the server manually (for debugging)
  npm run dev     - Run in watch mode during development
  npm run build   - Rebuild after code changes

${colors.dim}Configuration file: ${join(__dirname, 'd365-environments.json')}${colors.reset}
`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    clearScreen();
    printHeader();

    // Phase 1: Prerequisites
    await checkPrerequisites(rl);

    // Phase 2: Collect configuration
    const config = await collectAllEnvironments(rl);

    if (!config) {
      console.log('\nSetup cancelled. Use environment variables for configuration.');
      rl.close();
      return;
    }

    // Phase 3: Test connectivity
    await testAllConnectivity(rl, config);

    // Phase 4: Write configuration
    const saved = await writeConfigFile(rl, config);

    if (!saved) {
      console.log('\nConfiguration was not saved, but you can still configure Claude integration.');
    }

    // Phase 5: Claude integration
    await configureClaudeIntegration(rl, config);

    // Phase 6: Summary
    if (saved) {
      printSummary(config);
    }

  } catch (error) {
    if (error.code === 'ERR_USE_AFTER_CLOSE') {
      // User pressed Ctrl+C
      console.log('\n\nSetup cancelled.');
    } else {
      console.error(`\n${colors.red}Error: ${error.message}${colors.reset}`);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    }
  } finally {
    rl.close();
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\nSetup cancelled.');
  process.exit(0);
});

main();
