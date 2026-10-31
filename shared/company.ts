// Company identity shown in the UI and given to every agent. Edit here to rebrand.
export const COMPANY = {
  name: "Rootsapiens",
  kind: "Digital Transformation",
  pitch: "We move companies from paper, spreadsheets and legacy systems to simple, working digital products and automated workflows.",
} as const;

/** Display names of the office rooms (ids stay stable for saved data and tests). */
export const ROOM_LABELS = {
  "command-deck": "Executive Office",
  engineering: "Engineering",
  "art-studio": "Design Studio",
  "writers-room": "Research Lab",
  hr: "People & Culture",
  "animation-bay": "Media Lab",
  "meeting-room": "Meeting Room",
  pantry: "Pantry",
  commons: "Commons",
} as const;
