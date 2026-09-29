export interface StravaAthleteSummary {
  id: number;
  firstname?: string;
  lastname?: string;
  username?: string;
  profile?: string;
}

export interface StravaTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  athlete: StravaAthleteSummary;
  createdAt: number;
  updatedAt: number;
}

export interface StoredStravaAccount {
  userId: string;
  tokens: StravaTokenSet;
}
