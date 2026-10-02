/**
 * Bootstrap stores return binary bytes and the ETag from that same read.
 * Conditional writes return false only for a version/create conflict; transport
 * failures reject. Mutable creates must never overwrite an existing object.
 *
 * @typedef {{ body: Buffer | null, etag: string | null }} BootstrapSnapshot
 * @typedef {{
 *   read: (path: string) => Promise<Buffer | null>,
 *   readSnapshot: (path: string) => Promise<BootstrapSnapshot>,
 *   create: (path: string, body: Buffer, contentType?: string) => Promise<boolean>,
 *   createMutable: (path: string, body: Buffer, contentType?: string) => Promise<boolean>,
 *   compareAndSet: (path: string, etag: string, body: Buffer, contentType?: string) => Promise<boolean>,
 *   put: (path: string, body: Buffer, contentType?: string) => Promise<void>,
 *   delete: (path: string) => Promise<void>,
 *   checkIdentity?: () => Promise<void>,
 * }} BootstrapStore
 * @typedef {Pick<BootstrapStore, 'readSnapshot' | 'createMutable' | 'compareAndSet'>} BootstrapLeaseStore
 * @typedef {Pick<BootstrapStore, 'read' | 'create'>} BootstrapStagingStore
 * @typedef {BootstrapStagingStore & {
 *   put: (path: string, body: Buffer, contentType?: string) => Promise<unknown>,
 * } & Partial<Pick<BootstrapStore, 'createMutable' | 'delete'>>} BootstrapPublicationStore
 *
 * The required lease fields match the validated shared Workflow record.
 * Additional provenance fields are optional for compatible existing records.
 * @typedef {{
 *   run_id: string,
 *   status: 'running' | 'published' | 'failed',
 *   expires_at: string,
 *   fencing_token: number,
 *   acquired_at?: string,
 *   idempotency_key?: string,
 *   trigger?: string,
 * }} BootstrapLease
 */

export {};
