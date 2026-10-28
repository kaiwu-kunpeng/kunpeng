export interface EarsRequirement {
  trigger: string | null;
  response: string;
  raw: string;
}

const EVENT_DRIVEN_EARS = /^\s*WHEN\s+(.+?)\s+THE\s+SYSTEM\s+SHALL\s*(.*)\s*$/i;
const UBIQUITOUS_EARS = /^\s*THE\s+SYSTEM\s+SHALL\s*(.*)\s*$/i;

export function parseEars(text: string): EarsRequirement[] {
  const requirements: EarsRequirement[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const eventDriven = EVENT_DRIVEN_EARS.exec(raw);
    if (eventDriven) {
      requirements.push({
        trigger: eventDriven[1].trim(),
        response: eventDriven[2].trim(),
        raw,
      });
      continue;
    }

    const ubiquitous = UBIQUITOUS_EARS.exec(raw);
    if (ubiquitous) {
      requirements.push({
        trigger: null,
        response: ubiquitous[1].trim(),
        raw,
      });
    }
  }

  return requirements;
}

export function isTestable(r: EarsRequirement): boolean {
  return r.response.trim() !== "";
}
