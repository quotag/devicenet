import { Rule as RuleSchema, Scene as SceneSchema, type Rule, type Scene } from '@devicenet/shared';
import { brokenReason, type DeviceLookup } from '../automation/compile.js';
import type { SiteInfo } from '../automation/conditions.js';
import type { ConfigApply, HubFieldWrite } from '../automation/configApply.js';
import type { SnapshotRepo } from '../store/snapshot.js';
import type { ConfigStore, Site, Unsubscribe } from './ConfigStore.js';

type Log = { warn(obj: object, msg?: string): void; info?(obj: object, msg?: string): void };

export interface RuleSyncOptions {
  engine: { load(rules: Rule[]): void; setSite(site: SiteInfo | null): void };
  runner: { rulesChanged(): void };
  apply: Pick<ConfigApply, 'apply' | 'flushAll' | 'reset'>;
  /** B18 rule/scene cache for removal → broken */
  lifecycle?: { setRulesAndScenes(rules: Rule[], scenes: Scene[]): void };
  lookup: DeviceLookup;
  log?: Log;
}

export const toSiteInfo = (s: Site | null): SiteInfo | null =>
  s ? { timezone: s.timezone, ...(s.lat !== undefined ? { lat: s.lat } : {}), ...(s.lng !== undefined ? { lng: s.lng } : {}) } : null;

/**
 * Firestore rules/scenes/site listeners (`where hubId == me`) → engine load (diff by rev inside the
 * engine) → `appliedRev` batch + `config.applied` (data-model §3.4). Boots from config_snapshot so
 * automations run while offline.
 */
export class RuleSync {
  private rules: Rule[] = [];
  private scenes: Scene[] = [];
  private store: ConfigStore | null = null;
  private unsubs: Unsubscribe[] = [];
  private applying: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: RuleSyncOptions) {}

  getRule = (id: string): Rule | undefined => this.rules.find((r) => r.id === id);
  getScene = (id: string): Scene | undefined => this.scenes.find((s) => s.id === id);
  allRules = (): Rule[] => this.rules;
  allScenes = (): Scene[] => this.scenes;

  /** Last cached config (SQLite config_snapshot) — used at boot before / without Firestore. */
  loadSnapshot(repo: SnapshotRepo): void {
    const parse = <T>(kind: 'rules' | 'scenes', schema: { safeParse(v: unknown): { success: boolean; data?: unknown } }): T[] => {
      const row = repo.get<unknown[]>(kind);
      if (!Array.isArray(row?.json)) return [];
      return row.json.flatMap((d) => {
        const r = schema.safeParse(d);
        return r.success ? [r.data as T] : [];
      });
    };
    const site = repo.get<Site>('site')?.json ?? null;
    if (site) this.o.engine.setSite(toSiteInfo(site));
    this.rules = parse<Rule>('rules', RuleSchema);
    this.scenes = parse<Scene>('scenes', SceneSchema);
    this.loadEngine();
  }

  attach(store: ConfigStore): void {
    this.detach();
    this.store = store;
    this.o.apply.reset();
    this.unsubs = [
      store.onSite((site) => this.o.engine.setSite(toSiteInfo(site))),
      store.onRules((rules) => {
        this.rules = rules;
        this.changed();
      }),
      store.onScenes((scenes) => {
        this.scenes = scenes;
        this.changed();
      }),
      store.onSignInState((s) => {
        if (s === 'signed-in') void this.o.apply.flushAll();
      }),
    ];
  }

  detach(): void {
    for (const u of this.unsubs.splice(0)) u();
    this.store = null;
  }

  /** Re-check broken state and re-apply (e.g. config.resync or after a device removal). */
  resync(): Promise<void> {
    this.changed();
    return this.applying.then(() => undefined);
  }

  private loadEngine(): void {
    this.o.engine.load(this.rules);
    this.o.runner.rulesChanged();
    this.o.lifecycle?.setRulesAndScenes(this.rules, this.scenes);
  }

  private changed(): void {
    this.loadEngine();
    if (!this.store) return;
    const rules = this.rules;
    const scenes = this.scenes;
    const extra = this.sceneBrokenWrites(scenes);
    // serialize applies so two snapshots never race on appliedRev
    this.applying = this.applying
      .then(() => this.o.apply.apply(rules, scenes, extra))
      .catch((e) => this.o.log?.warn({ err: (e as Error).message }, 'config apply failed'));
  }

  /** Scenes referencing a removed device / missing property → broken (once; rules are handled by the engine). */
  private sceneBrokenWrites(scenes: Scene[]): HubFieldWrite[] {
    const out: HubFieldWrite[] = [];
    for (const s of scenes) {
      if (s.lastResult === 'broken') continue;
      const reason = brokenReason(s, this.o.lookup);
      if (reason) out.push({ kind: 'scene', id: s.id, patch: { lastResult: 'broken', brokenReason: reason } });
    }
    return out;
  }
}
