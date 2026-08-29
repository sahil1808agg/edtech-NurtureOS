/**
 * Scale normalisation — maps every board's marking scheme onto 0..1.
 *
 * The normalised value is only meaningful WITHIN a single scale. Comparing a
 * 0.75 from IB_OPCE to a 0.75 from PCT is not valid, which is why every
 * observation stores its scaleId and buildTrajectory refuses mixed scales.
 *
 * Mirrors the `scales` and `scale_values` tables in
 * docs/specs/supabase-schema.sql.
 */

export interface Scale {
  id: string;
  board: string;
  description: string;
  /** discrete raw value → normalised, for enumerated scales */
  values?: Record<string, number>;
  /** for continuous scales such as percentages */
  parse?: (raw: string) => number | null;
}

/** Values that mean "no assessment recorded", not "scored zero". */
const AMBIGUOUS_TOKENS = new Set(["-", "–", "—", "", "n/a", "na", "not assessed"]);

export function isAmbiguousRaw(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return true;
  return AMBIGUOUS_TOKENS.has(raw.trim().toLowerCase());
}

export const SCALES: Record<string, Scale> = {
  IB_OPCE: {
    id: "IB_OPCE",
    board: "IB",
    description: "Outstanding / Proficient / Consolidating / Emerging",
    values: { O: 1.0, P: 0.75, C: 0.5, E: 0.25 },
  },
  IB_MYP_1_8: {
    id: "IB_MYP_1_8",
    board: "IB",
    description: "MYP criterion levels 1-8",
    values: Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [String(i + 1), (i + 1) / 8]),
    ),
  },
  EE_ME_AE_BE: {
    id: "EE_ME_AE_BE",
    board: "IB",
    description: "Exceeding / Meeting / Approaching / Below expectations",
    values: { EE: 1.0, ME: 0.75, AE: 0.5, BE: 0.25 },
  },
  CAIE_AG: {
    id: "CAIE_AG",
    board: "CAIE",
    description: "Cambridge A* to G",
    values: {
      "A*": 1.0, A: 0.9, B: 0.8, C: 0.7,
      D: 0.6, E: 0.5, F: 0.4, G: 0.3,
    },
  },
  PCT: {
    id: "PCT",
    board: "CBSE",
    description: "Percentage",
    parse: (raw) => {
      const n = Number(raw.replace("%", "").trim());
      if (!Number.isFinite(n) || n < 0 || n > 100) return null;
      return n / 100;
    },
  },
};

export interface NormaliseOutcome {
  normalised: number | null;
  isAmbiguous: boolean;
  /** true when the scale is known but the value is not one of its members */
  unrecognised: boolean;
}

export function normaliseValue(
  scaleId: string,
  raw: string | null | undefined,
): NormaliseOutcome {
  if (isAmbiguousRaw(raw)) {
    return { normalised: null, isAmbiguous: true, unrecognised: false };
  }

  const scale = SCALES[scaleId];
  const value = (raw as string).trim();

  if (!scale) {
    return { normalised: null, isAmbiguous: false, unrecognised: true };
  }

  if (scale.parse) {
    const parsed = scale.parse(value);
    return {
      normalised: parsed,
      isAmbiguous: false,
      unrecognised: parsed === null,
    };
  }

  const key = value.toUpperCase();
  const mapped = scale.values?.[key];
  return mapped === undefined
    ? { normalised: null, isAmbiguous: false, unrecognised: true }
    : { normalised: mapped, isAmbiguous: false, unrecognised: false };
}
