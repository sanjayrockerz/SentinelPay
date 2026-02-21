import { SHA256 } from './crypto';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface Transaction {
  transaction_id: string;
  user_id: string;
  amount: number;
  timestamp: number;
  device_id: string;
  ip_address: string;
  location: { lat: number; lon: number; city: string };
  merchant_id: string;
  merchant_category?: string;
  network_type: 'WIFI' | '4G' | '5G' | 'VPN' | 'UNKNOWN';
  session_id: string;
}

export interface UserProfile {
  user_id: string;
  registered_city: string;
  registered_device_id: string;
  avg_transaction_amount: number;
  max_transaction_amount: number;
  daily_transaction_limit: number;
  avg_transactions_per_day: number;
  kyc_status: 'VERIFIED' | 'PENDING' | 'FAILED';
  risk_category: 'LOW' | 'MEDIUM' | 'HIGH';
  account_status: 'ACTIVE' | 'DORMANT' | 'BLOCKED';
  usual_login_times: [number, number]; // Start hour, End hour (e.g., [9, 22])
  last_login: number;
  failed_attempts_last_10_min: number;
}

export interface RiskResult {
  score: number;
  reasoning: string[];
  multiplier?: number;
}

export type ReasonCode =
  | 'ERR_VELOCITY_LIMIT'
  | 'ERR_GEO_IMPOSSIBLE'
  | 'ERR_BEHAVIORAL_SHIFT'
  | 'ERR_COORDINATED_ATTACK'
  | 'ERR_ESCALATION_OVERRIDE'
  | 'ERR_CHAIN_MISMATCH'
  | 'ERR_BLOCKED_USER'
  | 'OK';

export interface FinalRiskResult {
  transaction_id: string;
  user_id: string;
  amount: number;
  timestamp: number;
  final_risk_score: number;
  component_scores: {
    geo_risk: number;
    velocity_risk: number;
    device_risk: number;
    amount_risk: number;
    network_risk: number;
    behavioral_risk: number;
  };
  decision: 'APPROVE' | 'STEP_UP' | 'BLOCK';
  reasoning: string[];
  reason_code: ReasonCode;
  processing_time_ms: number;
  latency_breach: boolean;
  coordinated_attack: boolean;
  escalation_override: boolean;
}

export interface LedgerEntry {
  index: number;
  transaction_id: string;
  timestamp: number;
  final_risk_score: number;
  decision: string;
  previous_hash: string;
  current_hash: string;
  data_hash: string; // Hash of the transaction data itself
}

// ─────────────────────────────────────────────
// CONSTANTS — spec-mandated thresholds
// ─────────────────────────────────────────────

const R_EARTH_KM      = 6371;
const MAX_SPEED_KMH   = 800;

// Risk thresholds (spec §2)
export const THRESHOLD_PASS  = 40;   // < 40  → APPROVE
export const THRESHOLD_BLOCK = 70;   // ≥ 70  → BLOCK
                                      // 40–69 → STEP_UP

// Latency (spec §6)
const MAX_LATENCY_MS  = 200;
const LATENCY_WINDOW  = 10;

// Coordinated attack (spec §4)
const COORD_WINDOW_MS       = 2 * 60 * 1000;
const COORD_MIN_USERS       = 5;
const COORD_AMOUNT_VARIANCE = 0.05;
const COORD_MULTIPLIER      = 1.25;

// Progressive escalation (spec §5)
const ESC_WINDOW_MS   = 15 * 60 * 1000;
const ESC_MIN_STEPUPS = 3;
const ESC_RISK_THRESH = 60;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
    Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2;
  return R_EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clamp(v: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, v));
}

// ─────────────────────────────────────────────
// ROLLING LATENCY BUFFER (spec §6)
// ─────────────────────────────────────────────

class RollingLatencyBuffer {
  private buffer: number[] = [];

  record(ms: number): void {
    this.buffer.push(ms);
    if (this.buffer.length > LATENCY_WINDOW) this.buffer.shift();
  }

  average(): number {
    if (!this.buffer.length) return 0;
    return this.buffer.reduce((a, b) => a + b, 0) / this.buffer.length;
  }

  isBreach(): boolean { return this.average() > MAX_LATENCY_MS; }
  snapshot(): number[] { return [...this.buffer]; }
}

// ─────────────────────────────────────────────
// COORDINATED ATTACK DETECTOR (spec §4)
// ─────────────────────────────────────────────

interface CoordEvent {
  user_id: string;
  merchant_category: string;
  amount: number;
  timestamp: number;
}

class CoordinatedAttackDetector {
  private events: CoordEvent[] = [];

  record(tx: Transaction): void {
    const now = tx.timestamp;
    this.events = this.events.filter(e => now - e.timestamp <= COORD_WINDOW_MS);
    this.events.push({
      user_id:           tx.user_id,
      merchant_category: tx.merchant_category ?? tx.merchant_id,
      amount:            tx.amount,
      timestamp:         now,
    });
    if (this.events.length > 5000) this.events = this.events.slice(-5000);
  }

  detect(tx: Transaction): boolean {
    const now     = tx.timestamp;
    const cat     = tx.merchant_category ?? tx.merchant_id;
    const window  = this.events.filter(e => now - e.timestamp <= COORD_WINDOW_MS);
    const amtLow  = tx.amount * (1 - COORD_AMOUNT_VARIANCE);
    const amtHigh = tx.amount * (1 + COORD_AMOUNT_VARIANCE);
    const cluster = window.filter(
      e => e.merchant_category === cat && e.amount >= amtLow && e.amount <= amtHigh
    );
    return new Set(cluster.map(e => e.user_id)).size >= COORD_MIN_USERS;
  }
}

// ─────────────────────────────────────────────
// PROGRESSIVE ESCALATION TRACKER (spec §5)
// ─────────────────────────────────────────────

interface EscalationState {
  stepUpTimestamps: number[];
}

class EscalationTracker {
  private state: Map<string, EscalationState> = new Map();

  private get(userId: string): EscalationState {
    if (!this.state.has(userId)) this.state.set(userId, { stepUpTimestamps: [] });
    return this.state.get(userId)!;
  }

  recordStepUp(userId: string, ts: number): void {
    const s = this.get(userId);
    const cutoff = ts - ESC_WINDOW_MS;
    s.stepUpTimestamps = s.stepUpTimestamps.filter(t => t > cutoff);
    s.stepUpTimestamps.push(ts);
  }

  recordBlock(userId: string): void {
    const s = this.get(userId);
    s.stepUpTimestamps = [];
  }

  shouldForceBlock(userId: string, currentScore: number, ts: number): boolean {
    const s      = this.get(userId);
    const cutoff = ts - ESC_WINDOW_MS;
    const recent = s.stepUpTimestamps.filter(t => t > cutoff).length;
    return recent >= ESC_MIN_STEPUPS && currentScore >= ESC_RISK_THRESH;
  }
}

// ─────────────────────────────────────────────
// RISK ENGINES
// ─────────────────────────────────────────────

export class GeoRiskEngine {
  evaluate(tx: Transaction, profile: UserProfile, lastTx?: Transaction): RiskResult {
    let score = 0;
    const reasons: string[] = [];

    if (tx.location.city !== profile.registered_city) {
      score += 10;
      reasons.push(`ERR_GEO_IMPOSSIBLE: Location mismatch — ${tx.location.city} vs ${profile.registered_city}`);
    }

    if (lastTx) {
      const dist    = haversine(lastTx.location.lat, lastTx.location.lon, tx.location.lat, tx.location.lon);
      const diffHrs = (tx.timestamp - lastTx.timestamp) / 3_600_000;
      if (diffHrs > 0 && dist / diffHrs > MAX_SPEED_KMH) {
        score += 55;
        reasons.push(`ERR_GEO_IMPOSSIBLE: Impossible travel ${dist.toFixed(1)} km in ${diffHrs.toFixed(2)} h`);
      }
    }

    return { score: clamp(score, 0, 65), reasoning: reasons };
  }
}

export class VelocityRiskEngine {
  evaluate(tx: Transaction, recentTxns: Transaction[], profile: UserProfile): RiskResult {
    let score = 0;
    const reasons: string[] = [];
    const tenMinsAgo  = tx.timestamp - 600_000;
    const recentCount = recentTxns.filter(t => t.timestamp > tenMinsAgo).length;

    if (recentCount > 5) {
      score += 30;
      reasons.push(`ERR_VELOCITY_LIMIT: ${recentCount} transactions in last 10 min`);
    }

    const spamCount = recentTxns.filter(t => t.timestamp > tenMinsAgo && t.amount === 1).length;
    if (tx.amount === 1 && spamCount > 3) {
      score += 30;
      reasons.push('ERR_VELOCITY_LIMIT: ₹1 spam burst detected');
    }

    if (profile.failed_attempts_last_10_min > 3) {
      score += 35;
      reasons.push(`ERR_VELOCITY_LIMIT: ${profile.failed_attempts_last_10_min} failed attempts in 10 min`);
    }

    return { score: clamp(score, 0, 65), reasoning: reasons };
  }
}

export class DeviceRiskEngine {
  evaluate(tx: Transaction, profile: UserProfile, distinctDevicesLast5Min: number): RiskResult {
    let score = 0;
    const reasons: string[] = [];

    if (tx.device_id !== profile.registered_device_id) {
      score += 25;
      reasons.push(`ERR_BEHAVIORAL_SHIFT: Unregistered device — ${tx.device_id}`);
    }

    if (distinctDevicesLast5Min > 1) {
      score += 30;
      reasons.push(`ERR_BEHAVIORAL_SHIFT: Device switching — ${distinctDevicesLast5Min} devices in 5 min`);
    }

    return { score: clamp(score, 0, 55), reasoning: reasons };
  }
}

export class AmountRiskEngine {
  evaluate(tx: Transaction, profile: UserProfile): RiskResult {
    let score = 0;
    const reasons: string[] = [];

    if (tx.amount > profile.max_transaction_amount) {
      score += 75;
      reasons.push(`ERR_VELOCITY_LIMIT: Amount ₹${tx.amount} exceeds max ₹${profile.max_transaction_amount}`);
    } else if (tx.amount > profile.daily_transaction_limit) {
      score += 45;
      reasons.push('ERR_VELOCITY_LIMIT: Exceeds daily transaction limit');
    } else if (tx.amount > profile.avg_transaction_amount * 3) {
      score += 20;
      reasons.push(`ERR_BEHAVIORAL_SHIFT: Amount spike ₹${tx.amount} vs avg ₹${profile.avg_transaction_amount}`);
    }

    return { score: clamp(score, 0, 75), reasoning: reasons };
  }
}

export class NetworkSessionRiskEngine {
  evaluate(tx: Transaction): RiskResult {
    let score = 0;
    const reasons: string[] = [];

    if (tx.network_type === 'VPN') {
      score += 20;
      reasons.push('ERR_BEHAVIORAL_SHIFT: VPN detected');
    }
    if (tx.network_type === 'UNKNOWN') {
      score += 10;
      reasons.push('ERR_BEHAVIORAL_SHIFT: Unknown network type');
    }

    return { score: clamp(score, 0, 30), reasoning: reasons };
  }
}

export class BehavioralRiskEngine {
  evaluate(tx: Transaction, profile: UserProfile): RiskResult {
    let score = 0;
    let multiplier = 1.0;
    const reasons: string[] = [];
    const hour = new Date(tx.timestamp).getHours();

    if (hour < profile.usual_login_times[0] || hour > profile.usual_login_times[1]) {
      score += 10;
      reasons.push(`ERR_BEHAVIORAL_SHIFT: Transaction at unusual hour (${hour}:00)`);
    }

    if (profile.account_status === 'DORMANT') {
      score += 45;
      reasons.push('ERR_BEHAVIORAL_SHIFT: Dormant account activation');
    }

    if (profile.kyc_status === 'FAILED') {
      score += 35;
      reasons.push('ERR_BEHAVIORAL_SHIFT: KYC failed');
    } else if (profile.kyc_status === 'PENDING') {
      score += 10;
      reasons.push('ERR_BEHAVIORAL_SHIFT: KYC pending');
    }

    if (profile.risk_category === 'HIGH') {
      multiplier = 1.2;
      reasons.push('High-risk user profile (1.2× multiplier)');
    } else if (profile.risk_category === 'MEDIUM') {
      multiplier = 1.1;
      reasons.push('Medium-risk user profile (1.1× multiplier)');
    }

    return { score: clamp(score, 0, 65), reasoning: reasons, multiplier };
  }
}

// ─────────────────────────────────────────────
// SENTINEL ENGINE — MAIN AGGREGATOR
// ─────────────────────────────────────────────

export class SentinelEngine {
  private geoEngine         = new GeoRiskEngine();
  private velocityEngine    = new VelocityRiskEngine();
  private deviceEngine      = new DeviceRiskEngine();
  private amountEngine      = new AmountRiskEngine();
  private networkEngine     = new NetworkSessionRiskEngine();
  private behavioralEngine  = new BehavioralRiskEngine();
  private coordDetector     = new CoordinatedAttackDetector();
  private escalationTracker = new EscalationTracker();
  private latencyBuffer     = new RollingLatencyBuffer();

  private transactionHistory: Transaction[] = [];

  // ── Secondary check before SEND_OTP (spec §3) ─────────────────────────
  private secondaryCheck(tx: Transaction, _profile: UserProfile): boolean {
    const tenMinsAgo    = tx.timestamp - 600_000;
    const fiveMinsAgo   = tx.timestamp - 300_000;
    const userHistory   = this.transactionHistory.filter(t => t.user_id === tx.user_id);
    const recentCount   = userHistory.filter(t => t.timestamp > tenMinsAgo).length;
    const recentDevices = new Set(userHistory.filter(t => t.timestamp > fiveMinsAgo).map(t => t.device_id));
    recentDevices.add(tx.device_id);

    const velocityFail   = recentCount > 8;
    const deviceFail     = recentDevices.size > 2;
    const coordFail      = this.coordDetector.detect(tx);
    const escalationFail = this.escalationTracker.shouldForceBlock(tx.user_id, THRESHOLD_BLOCK, tx.timestamp);

    return !(velocityFail || deviceFail || coordFail || escalationFail);
  }

  // ── Main evaluate ──────────────────────────────────────────────────────
  evaluate(tx: Transaction, profile: UserProfile): FinalRiskResult {
    const start = performance.now();

    // Blocked user short-circuit
    if (profile.account_status === 'BLOCKED') {
      const ms = performance.now() - start;
      this.latencyBuffer.record(ms);
      return this.buildResult(
        tx, 100,
        { geo_risk: 0, velocity_risk: 0, device_risk: 0, amount_risk: 0, network_risk: 0, behavioral_risk: 0 },
        'BLOCK', ['ERR_BLOCKED_USER: Account is permanently blocked'],
        'ERR_BLOCKED_USER', ms, false, false
      );
    }

    const userHistory   = this.transactionHistory.filter(t => t.user_id === tx.user_id);
    const lastTx        = userHistory[userHistory.length - 1];
    const fiveMinsAgo   = tx.timestamp - 300_000;
    const recentDevices = new Set(userHistory.filter(t => t.timestamp > fiveMinsAgo).map(t => t.device_id));
    recentDevices.add(tx.device_id);

    const geo       = this.geoEngine.evaluate(tx, profile, lastTx);
    const velocity  = this.velocityEngine.evaluate(tx, userHistory, profile);
    const device    = this.deviceEngine.evaluate(tx, profile, recentDevices.size);
    const amount    = this.amountEngine.evaluate(tx, profile);
    const network   = this.networkEngine.evaluate(tx);
    const behav     = this.behavioralEngine.evaluate(tx, profile);

    const componentScores = {
      geo_risk:        geo.score,
      velocity_risk:   velocity.score,
      device_risk:     device.score,
      amount_risk:     amount.score,
      network_risk:    network.score,
      behavioral_risk: behav.score,
    };

    let baseScore = geo.score + velocity.score + device.score + amount.score + network.score + behav.score;

    if (behav.multiplier && behav.multiplier > 1) {
      baseScore = Math.floor(baseScore * behav.multiplier);
    }

    // Coordinated attack amplification (spec §4)
    let coordinated = false;
    this.coordDetector.record(tx);
    if (this.coordDetector.detect(tx)) {
      baseScore   = Math.floor(baseScore * COORD_MULTIPLIER);
      coordinated = true;
    }

    let finalScore = clamp(baseScore);

    const allReasons = [
      ...geo.reasoning, ...velocity.reasoning, ...device.reasoning,
      ...amount.reasoning, ...network.reasoning, ...behav.reasoning,
    ];

    if (coordinated) {
      allReasons.push('ERR_COORDINATED_ATTACK: Coordinated cluster detected (1.25× amplifier)');
    }

    // Decision logic (spec §2 + §3 + §5)
    let decision: 'APPROVE' | 'STEP_UP' | 'BLOCK' = 'APPROVE';
    let reasonCode: ReasonCode = 'OK';
    let escalationOverride = false;

    if (finalScore >= THRESHOLD_BLOCK) {
      decision   = 'BLOCK';
      reasonCode = coordinated ? 'ERR_COORDINATED_ATTACK' : this.primaryReasonCode(allReasons);
    } else if (finalScore >= THRESHOLD_PASS) {
      // Progressive escalation check first (spec §5)
      if (this.escalationTracker.shouldForceBlock(tx.user_id, finalScore, tx.timestamp)) {
        decision          = 'BLOCK';
        reasonCode        = 'ERR_ESCALATION_OVERRIDE';
        escalationOverride = true;
        finalScore        = Math.max(finalScore, 70);
        allReasons.push('ERR_ESCALATION_OVERRIDE: ≥3 OTP challenges in 15 min with risk ≥ 60 → forced BLOCK');
      } else {
        // Secondary check before issuing STEP_UP (spec §3)
        const otpAllowed = this.secondaryCheck(tx, profile);
        if (otpAllowed) {
          decision   = 'STEP_UP';
          reasonCode = this.primaryReasonCode(allReasons);
        } else {
          decision   = 'BLOCK';
          reasonCode = this.primaryReasonCode(allReasons);
        }
      }
    }

    // Update escalation state
    if (decision === 'STEP_UP') this.escalationTracker.recordStepUp(tx.user_id, tx.timestamp);
    if (decision === 'BLOCK')   this.escalationTracker.recordBlock(tx.user_id);

    // Store history (capped at 1000)
    this.transactionHistory.push(tx);
    if (this.transactionHistory.length > 1000) {
      this.transactionHistory = this.transactionHistory.slice(-1000);
    }

    const ms = performance.now() - start;
    this.latencyBuffer.record(ms);

    return this.buildResult(tx, finalScore, componentScores, decision, allReasons, reasonCode, ms, coordinated, escalationOverride);
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  private primaryReasonCode(reasons: string[]): ReasonCode {
    const priority: ReasonCode[] = [
      'ERR_CHAIN_MISMATCH', 'ERR_ESCALATION_OVERRIDE', 'ERR_COORDINATED_ATTACK',
      'ERR_GEO_IMPOSSIBLE', 'ERR_VELOCITY_LIMIT', 'ERR_BEHAVIORAL_SHIFT',
    ];
    for (const code of priority) {
      if (reasons.some(r => r.startsWith(code))) return code;
    }
    return 'OK';
  }

  private buildResult(
    tx: Transaction,
    score: number,
    componentScores: FinalRiskResult['component_scores'],
    decision: FinalRiskResult['decision'],
    reasons: string[],
    reasonCode: ReasonCode,
    ms: number,
    coordinated: boolean,
    escalation: boolean,
  ): FinalRiskResult {
    return {
      transaction_id:      tx.transaction_id,
      user_id:             tx.user_id,
      amount:              tx.amount,
      timestamp:           tx.timestamp,
      final_risk_score:    score,
      component_scores:    componentScores,
      decision,
      reasoning:           reasons,
      reason_code:         reasonCode,
      processing_time_ms:  ms,
      latency_breach:      this.latencyBuffer.isBreach(),
      coordinated_attack:  coordinated,
      escalation_override: escalation,
    };
  }

  getHistory(userId: string): Transaction[] {
    return this.transactionHistory.filter(t => t.user_id === userId);
  }

  getLatencyStats(): { average: number; breach: boolean; history: number[] } {
    return {
      average: this.latencyBuffer.average(),
      breach:  this.latencyBuffer.isBreach(),
      history: this.latencyBuffer.snapshot(),
    };
  }
}

