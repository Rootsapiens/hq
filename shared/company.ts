// Company identity shown in the UI and given to every agent. Edit here to rebrand.
export const COMPANY = {
  name: "Rootsapiens",
  kind: "AI Social Media Agency",
  pitch: "We plan, create and quality-check social media content for brands (posts, carousels, reels and stories), using AI for speed and people-grade review for quality.",
} as const;

/** Display names of the office rooms (ids stay stable for saved data and tests). */
export const ROOM_LABELS = {
  "command-deck": "Agency Desk",
  engineering: "Production & Data",
  "art-studio": "Creative Studio",
  "writers-room": "Strategy & Copy",
  hr: "Quality Desk",
  "animation-bay": "Reels Studio",
  "meeting-room": "Meeting Room",
  pantry: "Pantry",
  commons: "Commons",
} as const;
