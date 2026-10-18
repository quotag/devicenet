import type { z } from 'zod';
import type { Device, EventDoc as EventDocSchema, Room as RoomSchema, Rule, Scene, Site as SiteSchema } from '@devicenet/shared';

// shared exports these only as zod values; derive the types here.
export type EventDoc = z.infer<typeof EventDocSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Site = z.infer<typeof SiteSchema>;

export type Unsubscribe = () => void;

export type SignInState = 'signed-out' | 'signing-in' | 'signed-in' | 'error';

/** Hub-writable device fields (firestore.rules hub column). */
export type DeviceHubFields = Partial<
  Pick<Device, 'properties' | 'model' | 'vendor' | 'description' | 'firmware' | 'status' | 'removedAt' | 'updatedAt' | 'externalId'>
>;

/** Hub-writable rule/scene fields (firestore.rules hub column). */
export type RuleHubFields = Partial<Pick<Rule, 'appliedRev' | 'lastRunAt' | 'lastResult' | 'brokenReason'>>;
export type SceneHubFields = Partial<Pick<Scene, 'appliedRev' | 'lastRunAt' | 'lastResult' | 'brokenReason'>>;

/**
 * Hub's view of the cloud config store (Firestore in production, in-memory fake in tests).
 * All writes are limited to the hub column of firestore.rules.
 */
export interface ConfigStore {
  readonly signInState: SignInState;
  onSignInState(cb: (s: SignInState) => void): Unsubscribe;

  createDevice(device: Device): Promise<void>;
  updateDeviceHubFields(id: string, patch: DeviceHubFields): Promise<void>;
  putEvent(event: EventDoc): Promise<void>;
  updateRuleHubFields(id: string, patch: RuleHubFields): Promise<void>;
  updateSceneHubFields(id: string, patch: SceneHubFields): Promise<void>;
  /** B15: several rule/scene hub-field updates in one atomic batch (appliedRev). Optional: callers fall back to single updates. */
  batchHubFields?(writes: Array<{ kind: 'rule' | 'scene'; id: string; patch: RuleHubFields | SceneHubFields }>): Promise<void>;

  onDevices(cb: (devices: Device[]) => void): Unsubscribe;
  onSite(cb: (site: Site | null, rooms: Room[]) => void): Unsubscribe;
  onRules(cb: (rules: Rule[]) => void): Unsubscribe;
  onScenes(cb: (scenes: Scene[]) => void): Unsubscribe;
}
