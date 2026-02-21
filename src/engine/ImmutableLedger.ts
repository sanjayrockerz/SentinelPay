import { SHA256 } from './crypto';
import { FinalRiskResult, LedgerEntry } from './SentinelEngine';

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
      data_hash: '0'
    });
  }

  private calculateHash(index: number, prevHash: string, txId: string, score: number): string {
    const data = `${index}${prevHash}${txId}${score}`;
    return SHA256(data) || '';
  }

  addEntry(result: FinalRiskResult): LedgerEntry {
    const previousBlock = this.chain[this.chain.length - 1];
    const index = this.chain.length;
    
    const entry: LedgerEntry = {
      index,
      transaction_id: result.transaction_id,
      timestamp: Date.now(),
      final_risk_score: result.final_risk_score,
      decision: result.decision,
      previous_hash: previousBlock.current_hash,
      data_hash: SHA256(JSON.stringify(result)) || '',
      current_hash: ''
    };

    entry.current_hash = this.calculateHash(
      index, 
      entry.previous_hash, 
      entry.transaction_id, 
      entry.final_risk_score
    );

    this.chain.push(entry);
    return entry;
  }

  getChain(): LedgerEntry[] {
    return this.chain;
  }

  verifyIntegrity(): boolean {
    for (let i = 1; i < this.chain.length; i++) {
      const current = this.chain[i];
      const previous = this.chain[i - 1];

      if (current.previous_hash !== previous.current_hash) {
        console.error(`Chain broken at index ${i}: Previous hash mismatch`);
        return false;
      }

      const recalculatedHash = this.calculateHash(
        current.index,
        current.previous_hash,
        current.transaction_id,
        current.final_risk_score
      );

      if (current.current_hash !== recalculatedHash) {
        console.error(`Chain broken at index ${i}: Hash mismatch`);
        return false;
      }
    }
    return true;
  }
}
