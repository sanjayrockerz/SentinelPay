import { UserProfile } from './SentinelEngine';

export const MOCK_USERS: Record<string, UserProfile> = {
  'user_123': {
    user_id: 'user_123',
    registered_city: 'Mumbai',
    registered_device_id: 'dev_iphone_13_001',
    avg_transaction_amount: 2000,
    max_transaction_amount: 50000,
    daily_transaction_limit: 100000,
    avg_transactions_per_day: 5,
    kyc_status: 'VERIFIED',
    risk_category: 'LOW',
    account_status: 'ACTIVE',
    usual_login_times: [8, 23],
    last_login: Date.now() - 3600000,
    failed_attempts_last_10_min: 0
  },
  'user_fraud_test': {
    user_id: 'user_fraud_test',
    registered_city: 'Delhi',
    registered_device_id: 'dev_android_x_999',
    avg_transaction_amount: 500,
    max_transaction_amount: 10000,
    daily_transaction_limit: 20000,
    avg_transactions_per_day: 2,
    kyc_status: 'PENDING',
    risk_category: 'HIGH',
    account_status: 'ACTIVE',
    usual_login_times: [10, 18],
    last_login: Date.now() - 86400000,
    failed_attempts_last_10_min: 4
  }
};
