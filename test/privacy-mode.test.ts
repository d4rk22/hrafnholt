import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRIVACY_ALIASES,
  createPrivacyAliasRegistry,
  displayedPlexUsername,
  privacyModeKeyAction,
  sanitizedAliasList,
} from "../public/privacy-mode.js";

test("the alias pool covers the 24-stream contract with unique neutral names", () => {
  assert.equal(PRIVACY_ALIASES.length, 24);
  assert.equal(new Set(PRIVACY_ALIASES).size, PRIVACY_ALIASES.length);
  assert.deepEqual(PRIVACY_ALIASES.slice(0, 3), ["Acastus", "Admetus", "Ancaeus"]);
  assert.deepEqual(PRIVACY_ALIASES.slice(-3), ["Telamon", "Tiphys", "Zetes"]);
});

test("one registry gives each normalized username a stable unique alias", () => {
  const registry = createPrivacyAliasRegistry(() => 0.37);
  const first = registry.aliasFor("Primary Viewer");

  assert.ok(PRIVACY_ALIASES.includes(first));
  assert.equal(registry.aliasFor("  pRiMaRy ViEwEr  "), first);

  const aliases = [first, ...Array.from({ length: 23 }, (_, index) => registry.aliasFor(`viewer-${index}`))];
  assert.equal(new Set(aliases).size, 24);
  assert.ok(aliases.every((alias) => PRIVACY_ALIASES.includes(alias)));
});

test("separate registries can randomize the alias assignment", () => {
  const firstRegistry = createPrivacyAliasRegistry(() => 0);
  const secondRegistry = createPrivacyAliasRegistry(() => 0.999_999);

  assert.notEqual(firstRegistry.aliasFor("same viewer"), secondRegistry.aliasFor("same viewer"));
});

test("public presentation uses the registry while private presentation preserves the username", () => {
  const registry = createPrivacyAliasRegistry(() => 0.42);

  assert.equal(displayedPlexUsername("actual-user", "private", registry), "actual-user");
  assert.ok(PRIVACY_ALIASES.includes(displayedPlexUsername("actual-user", "public", registry)));
});

test("a configured roster replaces the built-in aliases and stays session-stable", () => {
  const roster = ["North", "South", "East", "West"];
  const registry = createPrivacyAliasRegistry(() => 0.11, roster);
  const first = registry.aliasFor("Primary Viewer");

  assert.ok(roster.includes(first));
  assert.equal(registry.aliasFor("  primary viewer "), first);
  const assigned = [first, ...roster.slice(1).map((_, index) => registry.aliasFor(`viewer-${index}`))];
  assert.equal(new Set(assigned).size, roster.length);
  assert.equal(registry.aliasFor("viewer-overflow"), registry.aliasFor("viewer-overflow"));
});

test("alias roster sanitization bounds entries and falls back to the built-ins", () => {
  assert.deepEqual(sanitizedAliasList(["  Lyra ", "Orion", "lyra", "", 7, "X".repeat(41)]), ["Lyra", "Orion"]);
  assert.equal(sanitizedAliasList(undefined), PRIVACY_ALIASES);
  assert.equal(sanitizedAliasList("North"), PRIVACY_ALIASES);
  assert.equal(sanitizedAliasList([]), PRIVACY_ALIASES);
  assert.equal(sanitizedAliasList(["Lonely"]), PRIVACY_ALIASES);
  assert.equal(sanitizedAliasList(Array.from({ length: 80 }, (_, index) => `Name${index}`)).length, 64);
});

test("privacy keyboard actions are deliberate and fail back to public", () => {
  assert.equal(privacyModeKeyAction({ key: "P", shiftKey: true }), "toggle");
  assert.equal(privacyModeKeyAction({ key: "p", shiftKey: true }), "toggle");
  assert.equal(privacyModeKeyAction({ key: "Escape" }), "public");
  assert.equal(privacyModeKeyAction({ key: "p" }), null);
  assert.equal(privacyModeKeyAction({ key: "P", shiftKey: true, repeat: true }), null);
  assert.equal(privacyModeKeyAction({ key: "P", shiftKey: true, metaKey: true }), null);
  assert.equal(privacyModeKeyAction({ key: "P", shiftKey: true, ctrlKey: true }), null);
  assert.equal(privacyModeKeyAction({ key: "P", shiftKey: true, altKey: true }), null);
  assert.equal(privacyModeKeyAction({ key: "P", shiftKey: true, defaultPrevented: true }), null);
  assert.equal(privacyModeKeyAction({ key: "P", shiftKey: true, target: { tagName: "INPUT" } }), null);
  assert.equal(privacyModeKeyAction({ key: "P", shiftKey: true, target: { isContentEditable: true } }), null);
});
