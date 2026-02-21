import { SHA256 } from './crypto'; // We'll implement a simple SHA256 wrapper or use a library if available, but for "no external APIs" in the logic, we might need a simple JS implementation or use the browser's crypto.subtle (which is async).
// Actually, the prompt asked for "hashlib" in Python. In JS, crypto.subtle is async.
// To keep it synchronous as requested ("No async" for the logic), I should use a synchronous SHA256 library or implementation.
// I'll use a simple synchronous SHA256 implementation for the demo to strictly adhere to "deterministic" and "sync" where possible in the logic layer.

// --- Types ---

export interface Transaction {
  transaction_id: string;
  user_id: string;
  amount: number;
  timestamp: number; // Unix timestamp
  device_id: string;
  ip_address: string;
  location: { lat: number; lon: number; city: string };
  merchant_id: string;
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
  processing_time_ms: number;
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

// --- Constants ---

const R_EARTH_KM = 6371;
const MAX_VELOCITY_WINDOW_MIN = 10;
const MAX_SPEED_KMH = 800; // Impossible travel speed

// --- Helper Functions ---

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_EARTH_KM * c;
}

// --- Risk Engines ---

export class GeoRiskEngine {
  evaluate(tx: Transaction, profile: UserProfile, lastTx?: Transaction): RiskResult {
    let score = 0;
    const reasons: string[] = [];

    // 1. City Mismatch
    if (tx.location.city !== profile.registered_city) {
      score += 10;
      reasons.push(`Location mismatch: Tx City (${tx.location.city}) != Reg City (${profile.registered_city})`);
    }

    // 2. Impossible Travel
    if (lastTx) {
      const distance = haversine(
        lastTx.location.lat,
        lastTx.location.lon,
        tx.location.lat,
        tx.location.lon
      );
      const timeDiffHours = (tx.timestamp - lastTx.timestamp) / (1000 * 60 * 60);
      
      if (timeDiffHours > 0) {
        const speed = distance / timeDiffHours;
        if (speed > MAX_SPEED_KMH) {
          score += 50;
          reasons.push(`Impossible Travel: ${distance.toFixed(1)}km in ${timeDiffHours.toFixed(2)}h (${speed.toFixed(1)} km/h)`);
        }
      }
    }

    return { score, reasoning: reasons };
  }
}

export class VelocityRiskEngine {
  evaluate(tx: Transaction, recentTxns: Transaction[], profile: UserProfile): RiskResult {
    let score = 0;
    const reasons: string[] = [];
    const now = tx.timestamp;
    
    // 1. Burst Detection (Last 10 mins)
    const tenMinsAgo = now - 10 * 60 * 1000;
    const recentCount = recentTxns.filter(t => t.timestamp > tenMinsAgo).length;
    
    if (recentCount > 5) {
      score += 20;
      reasons.push(`High Velocity: ${recentCount} txns in last 10 mins`);
    }

    // 2. ₹1 Spam Burst (common in UPI)
    const smallTxns = recentTxns.filter(t => t.timestamp > tenMinsAgo && t.amount === 1).length;
    if (tx.amount === 1 && smallTxns > 3) {
      score += 30;
      reasons.push('Suspected ₹1 Spam Burst');
    }

    // 3. Failed Attempts (Simulated from profile)
    if (profile.failed_attempts_last_10_min > 3) {
      score += 40;
      reasons.push(`Excessive Failed Attempts: ${profile.failed_attempts_last_10_min}`);
    }

    return { score, reasoning: reasons };
  }
}

export class DeviceRiskEngine {
  evaluate(tx: Transaction, profile: UserProfile, distinctDevicesLast5Min: number): RiskResult {
    let score = 0;
    const reasons: string[] = [];

    // 1. New Device
    if (tx.device_id !== profile.registered_device_id) {
      score += 25;
      reasons.push(`Unregistered Device: ${tx.device_id}`);
    }

    // 2. Device Switching
    if (distinctDevicesLast5Min > 1) {
      score += 30;
      reasons.push(`Device Switching Detected: ${distinctDevicesLast5Min} devices in 5 min`);
    }

    return { score, reasoning: reasons };
  }
}

export class AmountRiskEngine {
  evaluate(tx: Transaction, profile: UserProfile): RiskResult {
    let score = 0;
    const reasons: string[] = [];

    // 1. Max Limit
    if (tx.amount > profile.max_transaction_amount) {
      score += 100; // Immediate block usually
      reasons.push(`Exceeds Max Limit: ${tx.amount} > ${profile.max_transaction_amount}`);
    }

    // 2. Daily Limit (Simplified check)
    if (tx.amount > profile.daily_transaction_limit) {
      score += 50;
      reasons.push(`Exceeds Daily Limit`);
    }

    // 3. Abnormal Spike (> 3x Average)
    if (tx.amount > profile.avg_transaction_amount * 3) {
      score += 20;
      reasons.push(`Abnormal Amount Spike: ${tx.amount} (Avg: ${profile.avg_transaction_amount})`);
    }

    return { score, reasoning: reasons };
  }
}

export class NetworkSessionRiskEngine {
  evaluate(tx: Transaction, previousSessionId?: string): RiskResult {
    let score = 0;
    const reasons: string[] = [];

    // 1. VPN Detection
    if (tx.network_type === 'VPN') {
      score += 15;
      reasons.push('VPN Detected');
    }

    // 2. Session Replay
    if (previousSessionId && tx.session_id === previousSessionId) {
      // In a real scenario, reusing a session ID for a *new* login might be bad, 
      // but for transactions in the same session it's fine. 
      // Let's assume this checks for concurrent usage of same session from diff IP (simplified here)
    }

    // 3. Unknown Network
    if (tx.network_type === 'UNKNOWN') {
      score += 10;
      reasons.push('Unknown Network Type');
    }

    return { score, reasoning: reasons };
  }
}

export class BehavioralRiskEngine {
  evaluate(tx: Transaction, profile: UserProfile): RiskResult {
    let score = 0;
    let multiplier = 1.0;
    const reasons: string[] = [];
    const date = new Date(tx.timestamp);
    const hour = date.getHours();

    // 1. Unusual Time
    if (hour < profile.usual_login_times[0] || hour > profile.usual_login_times[1]) {
      score += 10;
      reasons.push(`Transaction outside usual hours (${hour}:00)`);
    }

    // 2. Dormant Account
    if (profile.account_status === 'DORMANT') {
      score += 50;
      reasons.push('Dormant Account Activation');
    }

    // 3. Risk Category Multiplier
    if (profile.risk_category === 'HIGH') {
      multiplier = 1.2;
      reasons.push('High Risk User Category (1.2x Multiplier)');
    } else if (profile.risk_category === 'MEDIUM') {
      multiplier = 1.1;
      reasons.push('Medium Risk User Category (1.1x Multiplier)');
    }

    return { score, reasoning: reasons, multiplier };
  }
}

// --- Main Aggregator ---

export class SentinelEngine {
  private geoEngine = new GeoRiskEngine();
  private velocityEngine = new VelocityRiskEngine();
  private deviceEngine = new DeviceRiskEngine();
  private amountEngine = new AmountRiskEngine();
  private networkEngine = new NetworkSessionRiskEngine();
  private behavioralEngine = new BehavioralRiskEngine();

  // In-memory state for simulation
  private transactionHistory: Transaction[] = [];
  
  evaluate(tx: Transaction, profile: UserProfile): FinalRiskResult {
    const start = performance.now();

    // Context gathering
    const userHistory = this.transactionHistory.filter(t => t.user_id === tx.user_id);
    const lastTx = userHistory[userHistory.length - 1];
    const recentTxns = userHistory; // In prod, filter by time window
    
    // Distinct devices in last 5 mins
    const fiveMinsAgo = tx.timestamp - 5 * 60 * 1000;
    const recentDevices = new Set(
      userHistory
        .filter(t => t.timestamp > fiveMinsAgo)
        .map(t => t.device_id)
    );
    recentDevices.add(tx.device_id);

    // Evaluate Components
    const geo = this.geoEngine.evaluate(tx, profile, lastTx);
    const velocity = this.velocityEngine.evaluate(tx, recentTxns, profile);
    const device = this.deviceEngine.evaluate(tx, profile, recentDevices.size);
    const amount = this.amountEngine.evaluate(tx, profile);
    const network = this.networkEngine.evaluate(tx);
    const behavioral = this.behavioralEngine.evaluate(tx, profile);

    // Weighted Sum (Simplified: 1.0 weight for all)
    let finalScore = 
      geo.score + 
      velocity.score + 
      device.score + 
      amount.score + 
      network.score + 
      behavioral.score;

    // Apply Multiplier
    if (behavioral.multiplier && behavioral.multiplier > 1) {
      finalScore = Math.floor(finalScore * behavioral.multiplier);
    }

    // Clamp to 0-100
    finalScore = Math.min(100, Math.max(0, finalScore));

    // Decision Logic
    let decision: 'APPROVE' | 'STEP_UP' | 'BLOCK' = 'APPROVE';
    if (finalScore >= 60) decision = 'BLOCK';
    else if (finalScore >= 30) decision = 'STEP_UP';

    // Store history (cap at 1000 entries to prevent unbounded memory growth)
    this.transactionHistory.push(tx);
    if (this.transactionHistory.length > 1000) {
      this.transactionHistory = this.transactionHistory.slice(-1000);
    }

    const end = performance.now();

    return {
      transaction_id: tx.transaction_id,
      user_id: tx.user_id,
      amount: tx.amount,
      timestamp: tx.timestamp,
      final_risk_score: finalScore,
      component_scores: {
        geo_risk: geo.score,
        velocity_risk: velocity.score,
        device_risk: device.score,
        amount_risk: amount.score,
        network_risk: network.score,
        behavioral_risk: behavioral.score,
      },
      decision,
      reasoning: [
        ...geo.reasoning,
        ...velocity.reasoning,
        ...device.reasoning,
        ...amount.reasoning,
        ...network.reasoning,
        ...behavioral.reasoning,
      ],
      processing_time_ms: end - start,
    };
  }

  getHistory(userId: string): Transaction[] {
    return this.transactionHistory.filter(t => t.user_id === userId);
  }
}
