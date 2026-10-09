import type { Rng } from "../../core/rng";

/** Things blobs yell. Pure data so lines come from the game's seeded RNG. */
export const QUIPS = {
  ouch: ["OW!", "MY FACE!", "RUDE!", "OOF", "HEY!!", "I FELT THAT", "NOT COOL", "MY GOO!"],
  bigOuch: ["WHAT WAS THAT?!", "I SAW MY LIFE FLASH", "EVERYTHING HURTS", "MOMMY"],
  flying: ["WHEEEE", "AAAAAA", "I CAN FLY!", "PUT ME DOWN!"],
  lastWords: ["TELL MY MOM...", "AVENGE MEEE", "WORTH IT", "I REGRET NOTHING", "NOOOOO", "SEE YOU IN BLOB HEAVEN", "IT'S SO WARM..."],
  lavaWords: ["HOT HOT HOT", "SPICY!", "NOT THE LAVA", "I'M MELTING"],
  selfOwn: ["...OOPS", "I MEANT THAT", "DON'T LOOK AT ME", "TACTICAL ERROR"],
  laugh: ["LOL", "HAHAHA", "NICE ONE", "CLASSIC", "EPIC FAIL"],
  gloat: ["GET REKT", "TOO EASY", "SIT DOWN", "NEXT!", "GG", "BOOM, BABY"],
  phew: ["MISSED ME!", "HA! WIDE!", "NOT TODAY", "WHIFF!"],
  chicken: ["BAWK?", "A CHICKEN?!", "SQUEAK.", "...REALLY?"],
  nuke: ["OH NO.", "I'D LIKE TO SURRENDER", "IS THAT LEGAL?", "RUN!!"],
  crate: ["MINE!", "OOH, LOOT", "PRESENT!", "FINDERS KEEPERS"],
  trap: ["IT WAS A TRAP!", "WHO PACKED THIS?!", "SHOULD'VE GUESSED"],
  teleport: ["BZZZT!", "NEW VIEW!", "I'M OVER HERE NOW", "BEAM ME UP"],
  swap: ["HEY, MY SPOT!", "SWAPSIES!", "WHERE AM I?"],
  sheep: ["BAAAA", "IS THAT A SHEEP?!", "THE SHEEP IS LOOKING AT ME"],
  bounty: ["THERE'S A PRICE ON MY HEAD?!", "WHY IS EVERYONE STARING?"],
  win: ["LAST BLOB STANDING!", "BOW BEFORE ME", "STILL GOT IT", "UNDEFEATED-ISH"],
} as const;

export type QuipKind = keyof typeof QUIPS;

export function quip(kind: QuipKind, rng: Rng): string {
  return rng.pick(QUIPS[kind]);
}

export type Persona = "hothead" | "sniper" | "clown" | "grudge";

export interface PersonaInfo {
  id: Persona;
  tag: string;
  /** Random aim wobble in radians. Lower = deadlier. */
  aimError: number;
  powerError: number;
  turnLines: readonly string[];
}

export const PERSONAS: Record<Persona, PersonaInfo> = {
  hothead: { id: "hothead", tag: "HOTHEAD", aimError: 0.09, powerError: 0.07, turnLines: ["EAT THIS!", "BOOM TIME", "NO MERCY!", "I'M SO ANGRY RIGHT NOW", "FEEL MY WRATH"] },
  sniper: { id: "sniper", tag: "SNIPER", aimError: 0.05, powerError: 0.045, turnLines: ["CALCULATED.", "WIND ADJUSTED.", "TOP DOG GOES DOWN", "ONE SHOT."] },
  clown: { id: "clown", tag: "CLOWN", aimError: 0.15, powerError: 0.11, turnLines: ["HONK HONK", "YOLO!", "NO IDEA WHAT I'M DOING", "WATCH THIS!", "PROBABLY FINE"] },
  grudge: { id: "grudge", tag: "GRUDGE", aimError: 0.07, powerError: 0.06, turnLines: ["REMEMBER ME?", "PAYBACK!", "YOU STARTED IT", "NEVER FORGET"] },
};

/** Bots get a personality by seat so a table always has a mix. */
export function personaFor(slot: number): Persona {
  return (["hothead", "sniper", "clown", "grudge"] as const)[slot % 4]!;
}
