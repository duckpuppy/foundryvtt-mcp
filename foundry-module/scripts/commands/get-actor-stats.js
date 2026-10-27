/**
 * Reads actors' prepared (derived) stats from this client: values the game
 * system computes at load time and never stores - in dnd5e, max HP, AC,
 * initiative bonus, ability modifiers and level. The server's world snapshot
 * only has stored data, so it cannot read these itself.
 *
 * Paths follow dnd5e; for other systems a missing value comes back as null.
 */

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** @param {unknown} value */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** @param {Actor} actor */
function statsOf(actor) {
  const system = actor.system ?? {};
  const attributes = system.attributes ?? {};
  const hp = attributes.hp ?? {};
  const abilities = {};
  for (const key of ABILITIES) {
    const ability = system.abilities?.[key];
    if (ability) {
      abilities[key] = {
        value: num(ability.value),
        mod: num(ability.mod),
        save: num(ability.save?.value ?? ability.save),
      };
    }
  }
  return {
    name: actor.name,
    type: actor.type,
    level: num(system.details?.level) ?? num(system.details?.cr),
    hp: { value: num(hp.value), max: num(hp.max), temp: num(hp.temp) },
    ac: num(attributes.ac?.value),
    init: num(attributes.init?.total ?? attributes.init?.mod),
    passivePerception: num(system.skills?.prc?.passive),
    spellDc: num(attributes.spell?.dc),
    abilities,
  };
}

/**
 * @param {{actorIds?: string[], tokens?: Array<{sceneId: string, tokenId: string}>}} params
 */
export async function getActorStats(params) {
  const results = [];
  for (const actorId of params.actorIds ?? []) {
    const actor = game.actors.get(actorId);
    results.push(actor ? { actorId, ...statsOf(actor) } : { actorId, error: 'Actor not found' });
  }
  for (const { sceneId, tokenId } of params.tokens ?? []) {
    const token = game.scenes.get(sceneId)?.tokens.get(tokenId);
    const actor = token?.actor;
    results.push(
      actor
        ? { sceneId, tokenId, actorId: actor.id, ...statsOf(actor), name: token.name }
        : { sceneId, tokenId, error: 'Token or its actor not found' },
    );
  }
  return { actors: results };
}
