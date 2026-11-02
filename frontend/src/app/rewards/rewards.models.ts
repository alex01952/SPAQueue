export interface StoreItem {
  itemId: string;
  name: string;
  imageUrl: string;
  merchantEmail: string;
  merchantCc: string;
  merchantBcc: string;
  tokenCost: number;
  enabled: boolean;
  version: string;
}

export interface Wallet {
  memberId: string;
  activeGold: boolean;
  points: number;
  tokens: number;
  convertedPoints: number;
  tokensSpent: number;
}

export interface RewardRecord {
  transactionId?: string;
  awardId?: string;
  type?: string;
  source?: string;
  activityDate?: string;
  scheduleName?: string;
  startHour?: number | null;
  courtNumber?: number | null;
  reason?: string;
  points: number;
  tokens?: number;
  itemName?: string;
  createdAt: string;
  convertedPoints?: number;
  used?: boolean;
  memberEmailStatus?: string;
  merchantEmailStatus?: string;
}

export type HistoryKind = 'award' | 'conversion' | 'redemption';
export interface RewardHistory {
  records: RewardRecord[];
  continuationToken: string | null;
}

export interface AdminRedemption extends RewardRecord {
  transactionId: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  merchantEmail: string;
  merchantCc: string;
  merchantBcc: string;
  itemId: string;
  imageUrl: string;
}

export interface AdminRedemptionHistory {
  records: AdminRedemption[];
  continuationToken: string | null;
}
