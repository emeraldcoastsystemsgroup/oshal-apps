/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Reproduce same-name cross-owner worker storage collisions and require immutable character namespaces with explicit existing-model compatibility.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/shared/logger', () => ({ createChildLogger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock('@/app/routes/remote-client-routes', () => ({ remoteClientRegistry: {} }));
import { buildTrainCommand, buildValidateCommand, buildImproveCommand, buildOvernightCommand } from '../src-routes/lora-train-dispatch';

const first = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', subject: 'same-character', triggerWord: 'public-trigger' };
const second = { ...first, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const keyA = 'lora-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa';
const keyB = 'lora-bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb';

describe('immutable worker character namespaces', () => {
  it('separates identical public names across every worker operation', () => {
    const commands = (config: typeof first, owner: string) => [
      buildTrainCommand(config, 2, 1, owner), buildValidateCommand(config, 2, owner),
      buildImproveCommand(config, 2, 1, ['profile'], owner), buildOvernightCommand(config, 1, 2, .005, owner),
    ];
    for (const [config, owner, key, other] of [[first, 'owner-a', keyA, keyB], [second, 'owner-b', keyB, keyA]] as const) {
      for (const command of commands(config, owner)) {
        expect(command).toContain(`--character '${key}'`);
        expect(command).toContain(`/${key}`);
        expect(command).not.toContain(other);
        expect(command).not.toContain('/same-character/');
      }
      expect(buildValidateCommand(config, 2, owner)).toContain(`--lora-name '${key}_v2.safetensors'`);
      expect(buildImproveCommand(config, 2, 1, [], owner)).toContain("--trigger 'public-trigger'");
    }
  });

  it('refuses a missing or malformed immutable id instead of using a shared path', () => {
    for (const id of ['', '../outside', 'not-a-uuid']) {
      expect(() => buildTrainCommand({ ...first, id }, 1, null, 'owner-a')).toThrow(/character id/);
    }
  });

  it('uses an existing model filename without returning to its shared dataset path', () => {
    const command = buildValidateCommand(first, 1, 'owner-a', 'same-character_v1.safetensors');
    expect(command).toContain("--lora-name 'same-character_v1.safetensors'");
    expect(command).toContain(`--character '${keyA}'`);
    expect(command).not.toContain('/same-character/');
    expect(() => buildValidateCommand(first, 1, 'owner-a', '../other.safetensors')).toThrow(/model filename/);
  });

  it('scores a legacy starting model in the new namespace before entering the overnight loop', () => {
    const command = buildOvernightCommand(first, 1, 2, .005, 'owner-a', 'same-character_v1.safetensors');
    expect(command).toContain("--lora-name 'same-character_v1.safetensors'");
    expect(command.indexOf('validate-lora.py')).toBeLessThan(command.indexOf('overnight-loop.py'));
    expect(command).toContain('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }');
  });
});
