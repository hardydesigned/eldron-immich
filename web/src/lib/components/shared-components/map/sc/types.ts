export type TimeRange = { after?: string; before?: string };

export type TrackPoint = {
  t: number;
  lat: number;
  lng: number;
  alt: number | null;
  speed: number | null;
  heading: number | null;
  battery: number | null;
};

export type Track = { assetId: string; start: number; end: number; points: TrackPoint[] };
