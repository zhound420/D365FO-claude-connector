/**
 * Circular buffer implementation for operation logging
 * Maintains a fixed-size buffer of recent operations
 */

import type { OperationLogEntry } from "./types.js";

/**
 * Generic circular buffer that maintains a fixed maximum size
 * When the buffer is full, oldest items are removed to make room for new ones
 */
export class CircularBuffer<T> {
  private buffer: T[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  /**
   * Add an item to the buffer
   * If buffer is full, removes the oldest item first
   */
  push(item: T): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
    }
    this.buffer.push(item);
  }

  /**
   * Get all items in the buffer, most recent first
   */
  getAll(): T[] {
    return [...this.buffer].reverse();
  }

  /**
   * Get items with a limit, most recent first
   */
  getRecent(limit: number): T[] {
    const all = this.getAll();
    return all.slice(0, Math.min(limit, all.length));
  }

  /**
   * Get the number of items in the buffer
   */
  get length(): number {
    return this.buffer.length;
  }

  /**
   * Clear all items from the buffer
   */
  clear(): void {
    this.buffer = [];
  }
}

/**
 * Operation log for a single environment
 * Wraps CircularBuffer with operation-specific functionality
 */
export class OperationLog {
  private buffer: CircularBuffer<OperationLogEntry>;

  constructor(maxSize: number = 50) {
    this.buffer = new CircularBuffer<OperationLogEntry>(maxSize);
  }

  /**
   * Log a new operation
   */
  log(entry: OperationLogEntry): void {
    this.buffer.push(entry);
  }

  /**
   * Get recent operations (most recent first)
   */
  getRecent(limit: number = 10): OperationLogEntry[] {
    return this.buffer.getRecent(limit);
  }

  /**
   * Get all operations (most recent first)
   */
  getAll(): OperationLogEntry[] {
    return this.buffer.getAll();
  }

  /**
   * Get the count of operations in the log
   */
  get count(): number {
    return this.buffer.length;
  }

  /**
   * Clear the operation log
   */
  clear(): void {
    this.buffer.clear();
  }
}
