export interface Crest {
  id: string;
  name: string;
  file: string;
}

/** Club crests from mapzimus World XI / soccer globe (Wikimedia + league sources). */
export const CRESTS: readonly Crest[] = [
  { id: "real-madrid", name: "Real Madrid", file: "real-madrid.png" },
  { id: "barcelona", name: "Barcelona", file: "barcelona.png" },
  { id: "man-utd", name: "Man United", file: "man-utd.png" },
  { id: "liverpool", name: "Liverpool", file: "liverpool.png" },
  { id: "bayern", name: "Bayern", file: "bayern.png" },
  { id: "juventus", name: "Juventus", file: "juventus.png" },
  { id: "ac-milan", name: "AC Milan", file: "ac-milan.png" },
  { id: "inter", name: "Inter", file: "inter.png" },
  { id: "psg", name: "PSG", file: "psg.png" },
  { id: "chelsea", name: "Chelsea", file: "chelsea.png" },
  { id: "arsenal", name: "Arsenal", file: "arsenal.png" },
  { id: "ajax", name: "Ajax", file: "ajax.png" },
  { id: "boca", name: "Boca Juniors", file: "boca.png" },
  { id: "river", name: "River Plate", file: "river.png" },
  { id: "flamengo", name: "Flamengo", file: "flamengo.png" },
  { id: "celtic", name: "Celtic", file: "celtic.png" },
  { id: "dortmund", name: "Dortmund", file: "dortmund.png" },
  { id: "revs", name: "New England", file: "revs.png" },
];

export const PAIR_FACES = CRESTS.map((crest) => crest.id);
