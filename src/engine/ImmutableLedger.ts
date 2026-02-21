import { SHA256 } from './crypto';
import { FinalRiskResult, LedgerEntry } from './SentinelEngine';

export type LedgerAddResult =
  | { ok: true;  entry: LedgerEntry }
  | { ok: false; reason: 'ERR_CHAIN_MISMATCH' };

export class ImmutableLedger {
  private chain: LedgerEntry[] = [];

  constructor() {
    // Genesis Block
    this.chain.push({
      index: 0,
      transaction_id: '00000000-0000-0000-0000-000000000000',
      timestamp: Date.now(),
      final_risk_score: 0,
      decision: 'GENESIS',
      previous_hash: '0',
      current_hash: this.calculateHash(0, '0', 'GENESIS', 0),
      data_hash: '0',
    });
  }

  private calculateHash(index: number, prevHash: string, txId: string, score: number): string {
    return SHA256(`${index}${prevHash}${txId}${score}`) || '';
  }

  // ── Plain add (does NOT verify integrity pre-check) ────────────────────
  addEntry(result: FinalRiskResult): LedgerEntry {
    const prev  = this.chain[this.chain.length - 1];
    const index = this.chain.length;

    const entry: LedgerEntry = {
      index,
      transaction_id:  result.transaction_id,
      timestamp:       Date.now(),
      final_risk_score: result.final_risk_score,
      decision:        result.decision,
      previous_hash:   prev.current_hash,
      data_hash:       SHA256(JSON.stringify(result)) || '',
      current_hash:    '',
    };

    entry.current_hash = this.calculateHash(
      index, entry.previous_hash, entry.transaction_id, entry.final_risk_score
    );

    this.chain.push(entry);
    return entry;
  }

  // ── Verified add (spec §7) — returns ERR_CHAIN_MISMATCH on tamper ─────
  verifyAndAdd(result: FinalRiskResult): LedgerAddResult {
    if (!this.verifyIntegrity()) {
      return { ok: false, reason: 'ERR_CHAIN_MISMATCH' };
    }
    return { ok: true, entry: this.addEntry(result) };
  }

  // ── Accessors ──────────────────────────────────────────────────────────
  getChain(): LedgerEntry[] {
    return this.chain;
  }

  getLatestHash(): string {
    return this.chain[this.chain.length - 1].current_hash;
  }

  verifyIntegrity(): boolean {
    for (let i = 1; i < this.chain.length; i++) {
      const current  = this.chain[i];
      const previous = this.chain[i - 1];

      if (current.previous_hash !== previous.current_hash) {
        console.error(`Chain broken at index ${i}: previous_hash mismatch`);
        return false;
      }

      const recalculated = this.calculateHash(
        current.index,
        current.previous_hash,
        current.transaction_id,
        current.final_risk_score,
      );

      if (current.current_hash !== recalculated) {
        console.error(`Chain broken at index ${i}: current_hash mismatch`);
        return false;
      }
    }
    return true;
  }
}

