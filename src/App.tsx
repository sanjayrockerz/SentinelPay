import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SentinelEngine, Transaction, FinalRiskResult, UserProfile, LedgerEntry } from './engine/SentinelEngine';
import { ImmutableLedger } from './engine/ImmutableLedger';
import { MOCK_USERS } from './engine/MockData';
import { Shield, AlertTriangle, CheckCircle, Activity, Lock, Globe, Smartphone, CreditCard, Wifi, User, Play, RotateCcw, FileText, Image as ImageIcon, Upload, Download, MapPin, Clock, Copy, Building2 } from 'lucide-react';
import { CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, RadialBarChart, RadialBar } from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI } from "@google/genai";
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Components ---

const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    APPROVE: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    STEP_UP: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    BLOCK: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
    GENESIS: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  };
  return (
    <span className={cn("px-2 py-1 rounded-md text-xs font-mono border", colors[status] || colors.APPROVE)}>
      {status}
    </span>
  );
};

const RiskScoreGauge = ({ score }: { score: number }) => {
  let color = 'text-emerald-500';
  if (score >= 70) color = 'text-rose-500';
  else if (score >= 40) color = 'text-amber-500';

  return (
    <div className="relative flex items-center justify-center w-32 h-32">
      <svg className="w-full h-full transform -rotate-90">
        <circle
          cx="64"
          cy="64"
          r="56"
          stroke="currentColor"
          strokeWidth="8"
          fill="transparent"
          className="text-slate-800"
        />
        <circle
          cx="64"
          cy="64"
          r="56"
          stroke="currentColor"
          strokeWidth="8"
          fill="transparent"
          strokeDasharray={351.86}
          strokeDashoffset={351.86 - (351.86 * score) / 100}
          className={cn(color, "transition-all duration-500 ease-out")}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn("text-3xl font-bold font-mono", color)}>{score}</span>
        <span className="text-xs text-slate-500 uppercase tracking-wider">Risk Score</span>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [engine] = useState(() => new SentinelEngine());
  const [ledger] = useState(() => new ImmutableLedger());
  const [transactions, setTransactions] = useState<FinalRiskResult[]>([]);
  const [ledgerChain, setLedgerChain] = useState<LedgerEntry[]>([]);
  const [selectedTx, setSelectedTx] = useState<FinalRiskResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [geminiAnalysis, setGeminiAnalysis] = useState<string | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3' | '3:4'>('16:9');
  const [users, setUsers] = useState<Record<string, UserProfile>>(() => ({ ...MOCK_USERS }));
  const [isUploadingTx, setIsUploadingTx] = useState(false);
  const [isUploadingUsers, setIsUploadingUsers] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userFileInputRef = useRef<HTMLInputElement>(null);
  const usersRef = useRef(users);

  // Raw transaction data (device, location, network, merchant) for selected tx
  const selectedTxRaw = useMemo(() =>
    selectedTx ? engine.getHistory(selectedTx.user_id).find(t => t.transaction_id === selectedTx.transaction_id) ?? null : null
  , [selectedTx]);

  // Keep usersRef in sync so simulation always reads latest users
  useEffect(() => { usersRef.current = users; }, [users]);

  // Auto-clear toast after 3s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Simulation Loop
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isSimulating) {
      interval = setInterval(() => {
        runSimulationStep();
      }, 2000); // New transaction every 2 seconds
    }
    return () => clearInterval(interval);
  }, [isSimulating]);

  // Initial Load
  useEffect(() => {
    setLedgerChain(ledger.getChain());
  }, []);

  const runSimulationStep = () => {
    // 1. Generate Random Transaction — always uses latest users via ref
    const isFraud = Math.random() > 0.7; // 30% chance of "weird" transaction
    const currentUsers = usersRef.current;
    const userKeys = Object.keys(currentUsers);
    const fraudKey = currentUsers['user_fraud_test'] ? 'user_fraud_test' : userKeys[userKeys.length - 1];
    const normalKey = currentUsers['user_123'] ? 'user_123' : userKeys[0];
    const user = isFraud ? currentUsers[fraudKey] : currentUsers[normalKey];
    
    const tx: Transaction = {
      transaction_id: crypto.randomUUID(),
      user_id: user.user_id,
      amount: isFraud ? Math.floor(Math.random() * 50000) : Math.floor(Math.random() * 5000),
      timestamp: Date.now(),
      device_id: isFraud && Math.random() > 0.5 ? 'unknown_device_' + Math.floor(Math.random()*100) : user.registered_device_id,
      ip_address: '192.168.1.1',
      location: isFraud ? { lat: 28.6139, lon: 77.2090, city: 'Delhi' } : { lat: 19.0760, lon: 72.8777, city: 'Mumbai' }, // Delhi vs Mumbai
      merchant_id: 'merch_001',
      network_type: isFraud && Math.random() > 0.5 ? 'VPN' : '4G',
      session_id: 'sess_' + Math.floor(Math.random() * 1000)
    };

    // 2. Evaluate
    const result = engine.evaluate(tx, user);

    // 3. Update Ledger
    ledger.addEntry(result);

    // 4. Update State
    setTransactions(prev => [result, ...prev].slice(0, 50));
    setLedgerChain([...ledger.getChain()]);
    setSelectedTx(result);
  };

  // --- Shared file parser: supports .csv, .xlsx, .xls ---
  const parseFileToRows = (file: File): Promise<any[]> =>
    new Promise((resolve, reject) => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'csv') {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results.data as any[]),
          error: (err: any) => reject(err.message),
        });
      } else if (ext === 'xlsx' || ext === 'xls') {
        const reader = new FileReader();
        reader.onerror = () => reject('Failed to read file');
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const wb = XLSX.read(data, { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            resolve(XLSX.utils.sheet_to_json<any>(sheet));
          } catch (err) { reject(String(err)); }
        };
        reader.readAsArrayBuffer(file);
      } else {
        reject('Unsupported format. Use .csv, .xlsx, or .xls');
      }
    });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploadingTx(true);
    try {
      const rows = await parseFileToRows(file);
      const newTransactions: FinalRiskResult[] = [];
      rows.forEach((row: any) => {
        if (!row.user_id || !row.amount) return;
        const user = users[row.user_id] || users['user_123'] || Object.values(users)[0];
        if (!user) return;
        const tx: Transaction = {
          transaction_id: row.transaction_id || crypto.randomUUID(),
          user_id: row.user_id,
          amount: parseFloat(row.amount),
          timestamp: row.timestamp ? new Date(row.timestamp).getTime() : Date.now(),
          device_id: row.device_id || user.registered_device_id,
          ip_address: row.ip_address || '127.0.0.1',
          location: {
            lat: parseFloat(row.lat) || 19.0760,
            lon: parseFloat(row.lon) || 72.8777,
            city: row.city || 'Mumbai',
          },
          merchant_id: row.merchant_id || 'unknown_merch',
          network_type: (row.network_type as any) || '4G',
          session_id: row.session_id || 'sess_imported',
        };
        const result = engine.evaluate(tx, user);
        ledger.addEntry(result);
        newTransactions.push(result);
      });
      setTransactions(prev => [...newTransactions.reverse(), ...prev].slice(0, 100));
      setLedgerChain([...ledger.getChain()]);
      if (newTransactions.length > 0) setSelectedTx(newTransactions[0]);
      setToast({ message: `Loaded ${newTransactions.length} transaction${newTransactions.length !== 1 ? 's' : ''}`, type: 'success' });
    } catch (err) {
      console.error('Transaction file error:', err);
      setToast({ message: `Failed to parse file: ${err}`, type: 'error' });
    } finally {
      setIsUploadingTx(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUserFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploadingUsers(true);
    try {
      const rows = await parseFileToRows(file);
      const newUsers: Record<string, UserProfile> = {};
      rows.forEach((row: any) => {
        if (!row.user_id) return;
        newUsers[row.user_id] = {
          user_id: row.user_id,
          registered_city: row.registered_city || 'Unknown',
          registered_device_id: row.registered_device_id || 'dev_unknown',
          avg_transaction_amount: parseFloat(row.avg_transaction_amount) || 1000,
          max_transaction_amount: parseFloat(row.max_transaction_amount) || 50000,
          daily_transaction_limit: parseFloat(row.daily_transaction_limit) || 100000,
          avg_transactions_per_day: parseFloat(row.avg_transactions_per_day) || 5,
          kyc_status: (row.kyc_status as UserProfile['kyc_status']) || 'VERIFIED',
          risk_category: (row.risk_category as UserProfile['risk_category']) || 'LOW',
          account_status: (row.account_status as UserProfile['account_status']) || 'ACTIVE',
          usual_login_times: [
            parseInt(row.usual_login_start) || 8,
            parseInt(row.usual_login_end) || 22,
          ],
          last_login: row.last_login ? new Date(row.last_login).getTime() : Date.now() - 3600000,
          failed_attempts_last_10_min: parseInt(row.failed_attempts_last_10_min) || 0,
        };
      });
      const count = Object.keys(newUsers).length;
      if (count === 0) {
        setToast({ message: 'No valid rows found. Ensure a "user_id" column exists.', type: 'error' });
        return;
      }
      setUsers(prev => ({ ...prev, ...newUsers }));
      setToast({ message: `Loaded ${count} user profile${count > 1 ? 's' : ''}`, type: 'success' });
    } catch (err) {
      console.error('User file error:', err);
      setToast({ message: `Failed to parse user file: ${err}`, type: 'error' });
    } finally {
      setIsUploadingUsers(false);
      if (userFileInputRef.current) userFileInputRef.current.value = '';
    }
  };

  const downloadTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + "user_id,amount,city,lat,lon,device_id,network_type,timestamp\n"
      + "user_123,5000,Mumbai,19.0760,72.8777,dev_iphone_13_001,4G,2023-10-27T10:00:00Z\n"
      + "user_fraud_test,99999,London,51.5074,-0.1278,unknown_device_99,VPN,2023-10-27T10:05:00Z";
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "sentinel_transaction_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadUserTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8,"
      + "user_id,registered_city,registered_device_id,avg_transaction_amount,max_transaction_amount,daily_transaction_limit,avg_transactions_per_day,kyc_status,risk_category,account_status,usual_login_start,usual_login_end,failed_attempts_last_10_min\n"
      + "user_newA,Bangalore,dev_samsung_001,3000,75000,150000,4,VERIFIED,LOW,ACTIVE,9,22,0\n"
      + "user_newB,Chennai,dev_pixel_007,800,20000,40000,3,PENDING,MEDIUM,ACTIVE,10,20,1";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "sentinel_user_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyTxId = (id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    });
  };

  const analyzeWithGemini = async (tx: FinalRiskResult) => {
    setIsAnalyzing(true);
    try {
      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        setGeminiAnalysis("API Key required for analysis.");
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const prompt = `
        Analyze this financial transaction risk report. 
        Risk Score: ${tx.final_risk_score}/100.
        Decision: ${tx.decision}.
        Reasoning: ${tx.reasoning.join(', ')}.
        Component Scores: ${JSON.stringify(tx.component_scores)}.
        
        Provide a concise, professional summary of why this transaction was flagged or approved, suitable for a fraud analyst.
      `;

      const result = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt
      });
      setGeminiAnalysis(result.text || "No analysis generated.");
    } catch (e: any) {
      console.error(e);
      if (e.message?.includes('403') || e.status === 403) {
         setGeminiAnalysis("Permission denied. Please check your API key.");
      } else {
         setGeminiAnalysis(`Analysis failed: ${e.message ?? e}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const generateFraudVisualization = async () => {
    setIsGeneratingImage(true);
    try {
      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        setToast({ message: 'API Key required for image generation.', type: 'error' });
        return;
      }

      const ai = new GoogleGenAI({ apiKey });

      const prompt = `A futuristic, high-tech visualization of a digital fraud firewall blocking a cyber attack. 
      Data streams, red alert nodes, secure shield, matrix style, dark mode UI aesthetics. 
      Cinematic lighting, ultra detailed.`;

      const result = await ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: aspectRatio,
        },
      });

      const imageBytes = result.generatedImages?.[0]?.image?.imageBytes;
      if (imageBytes) {
        setGeneratedImageUrl(`data:image/png;base64,${imageBytes}`);
      } else {
        setToast({ message: 'No image returned. The model may have filtered the prompt.', type: 'error' });
        console.error('Full response:', result);
      }
    } catch (e: any) {
      console.error(e);
      setToast({ message: `Image generation failed: ${e.message ?? e}`, type: 'error' });
    } finally {
      setIsGeneratingImage(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30">
      {/* Toast Notification */}
      {toast && (
        <div className={cn(
          'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl border transition-all animate-in fade-in slide-in-from-bottom-4',
          toast.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
        )}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.message}
        </div>
      )}
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-emerald-500" />
            <h1 className="text-lg font-bold tracking-tight text-white">
              Sentinel<span className="text-emerald-500">Pay</span>
              <span className="ml-3 text-xs font-mono text-slate-500 px-2 py-1 border border-slate-800 rounded">v1.0.0-PROTOTYPE</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400 mr-4">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              SYSTEM ONLINE
            </div>
            
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".csv,.xlsx,.xls"
              className="hidden"
            />
            <input 
              type="file" 
              ref={userFileInputRef}
              onChange={handleUserFileUpload}
              accept=".csv,.xlsx,.xls"
              className="hidden"
            />
            
            <div className="flex items-center gap-2 border-r border-slate-800 pr-4 mr-2">
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingTx}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 transition-colors text-slate-300 disabled:opacity-50"
                title="Upload Transactions (CSV / XLSX / XLS)"
              >
                <Upload className="w-3 h-3" /> {isUploadingTx ? 'Loading...' : 'Upload Data'}
              </button>
              <button 
                onClick={downloadTemplate}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                title="Download transaction CSV template"
              >
                <Download className="w-4 h-4" />
              </button>
              <button 
                onClick={() => userFileInputRef.current?.click()}
                disabled={isUploadingUsers}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 transition-colors text-slate-300 disabled:opacity-50"
                title="Upload User Profiles (CSV / XLSX / XLS)"
              >
                <Upload className="w-3 h-3" /> {isUploadingUsers ? 'Loading...' : 'Upload Users'}
              </button>
              <button 
                onClick={downloadUserTemplate}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                title="Download user profile CSV template"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>

            <button 
              onClick={() => setIsSimulating(!isSimulating)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                isSimulating 
                  ? "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border border-rose-500/20"
                  : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
              )}
            >
              {isSimulating ? <><RotateCcw className="w-4 h-4" /> Stop Simulation</> : <><Play className="w-4 h-4" /> Start Simulation</>}
            </button>
            <button
              onClick={() => (document.getElementById('architecture-modal') as HTMLDialogElement)?.showModal()}
              className="text-slate-400 hover:text-white transition-colors"
              title="System Architecture"
            >
              <FileText className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <dialog id="architecture-modal" className="bg-slate-900 text-slate-200 p-8 rounded-2xl border border-slate-800 max-w-2xl backdrop:bg-black/50">
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Shield className="w-8 h-8 text-emerald-500" />
            System Architecture
          </h2>
          <form method="dialog">
            <button className="text-slate-500 hover:text-white">✕</button>
          </form>
        </div>
        
        <div className="space-y-6 text-sm leading-relaxed text-slate-300">
          <section>
            <h3 className="text-emerald-400 font-mono font-bold uppercase mb-2">Core Design</h3>
            <p>
              SentinelPay is a deterministic, rule-based fraud detection engine designed for high-throughput UPI transactions. 
              It operates on a single-threaded event loop (simulated here) with O(1) in-memory lookups for user profiles.
            </p>
          </section>

          <section>
            <h3 className="text-emerald-400 font-mono font-bold uppercase mb-2">Risk Engines</h3>
            <ul className="list-disc pl-5 space-y-1 marker:text-emerald-500">
              <li><strong>GeoRiskEngine:</strong> Haversine distance calculation for impossible travel detection.</li>
              <li><strong>VelocityRiskEngine:</strong> Sliding window analysis for burst transaction patterns.</li>
              <li><strong>DeviceRiskEngine:</strong> Device fingerprinting and switching detection.</li>
              <li><strong>AmountRiskEngine:</strong> Statistical anomaly detection against user baselines.</li>
              <li><strong>NetworkSessionRiskEngine:</strong> VPN and session replay detection.</li>
              <li><strong>BehavioralRiskEngine:</strong> Time-of-day and account status analysis.</li>
            </ul>
          </section>

          <section>
            <h3 className="text-emerald-400 font-mono font-bold uppercase mb-2">Immutable Ledger</h3>
            <p>
              Every transaction decision is recorded in a cryptographically linked chain. 
              Each entry contains a SHA-256 hash of the previous block's hash + current transaction data, 
              ensuring tamper-evident audit trails.
            </p>
          </section>

          <div className="p-4 bg-slate-950 rounded border border-slate-800 font-mono text-xs text-slate-500">
            Stack: TypeScript, React, Tailwind CSS, SHA-256 (Custom Implementation), Gemini API (Analysis & Viz)
          </div>
        </div>
      </dialog>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Transaction Feed */}
        <div className="lg:col-span-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 7rem)' }}>
            <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-3 h-3" /> Live Stream
              </h2>
              <span className="text-[10px] font-mono text-slate-600 bg-slate-800 px-2 py-0.5 rounded-full">
                {transactions.length} txn{transactions.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="overflow-y-auto flex-1 p-2 space-y-1.5 custom-scrollbar">
            {transactions.map((tx) => (
              <div 
                key={tx.transaction_id}
                onClick={() => { setSelectedTx(tx); setGeminiAnalysis(null); }}
                className={cn(
                  "p-3 rounded-lg border cursor-pointer transition-all hover:bg-slate-800/50",
                  selectedTx?.transaction_id === tx.transaction_id 
                    ? "bg-slate-800 border-slate-600" 
                    : "bg-slate-900/50 border-slate-800"
                )}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="font-mono text-xs text-slate-500">{tx.transaction_id.slice(0, 8)}...</span>
                  <StatusBadge status={tx.decision} />
                </div>
                <div className="text-sm font-semibold text-slate-200 mb-1">₹{tx.amount.toLocaleString('en-IN')}</div>
                <div className="text-xs text-slate-500 font-mono mb-1 truncate">{tx.user_id}</div>
                <div className="flex justify-between items-end">
                  <div className="text-xs text-slate-400">
                    Risk: <span className={tx.final_risk_score >= 70 ? 'text-rose-500' : tx.final_risk_score >= 40 ? 'text-amber-400' : 'text-emerald-500'}>{tx.final_risk_score}</span>
                  </div>
                  <div className="text-xs font-mono text-slate-600">{new Date(tx.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
            {transactions.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-600 text-xs text-center px-4">
                  <Activity className="w-8 h-8 mb-3 opacity-20" />
                  <p className="font-medium text-slate-500">No transactions yet</p>
                  <p className="mt-1 text-slate-600">Start the simulation or upload a dataset</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Middle Column: Detail View */}
        <div className="lg:col-span-6 space-y-6">
          {selectedTx ? (
            <>
              {/* Main Score Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-6 opacity-10">
                  <Shield className="w-32 h-32" />
                </div>
                
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-1">Transaction Analysis</h2>
                    <button
                      onClick={() => copyTxId(selectedTx.transaction_id)}
                      className="flex items-center gap-1.5 text-slate-400 font-mono text-xs hover:text-emerald-400 transition-colors group"
                      title="Click to copy full ID"
                    >
                      <Copy className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                      {copiedId ? <span className="text-emerald-400">Copied!</span> : selectedTx.transaction_id}
                    </button>
                  </div>
                  <StatusBadge status={selectedTx.decision} />
                </div>

                {/* Reference Fields Grid */}
                <div className="grid grid-cols-2 gap-2 mb-6 p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                  {[
                    { label: 'User ID', value: selectedTx.user_id, icon: User, mono: true },
                    { label: 'Amount', value: `₹${selectedTx.amount.toLocaleString('en-IN')}`, icon: CreditCard, mono: false },
                    { label: 'Timestamp', value: new Date(selectedTx.timestamp).toLocaleString(), icon: Clock, mono: false },
                    { label: 'Processing', value: `${selectedTx.processing_time_ms.toFixed(2)} ms`, icon: Activity, mono: true },
                  ].map(({ label, value, icon: Icon, mono }) => (
                    <div key={label} className="flex items-start gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                      <Icon className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{label}</div>
                        <div className={`text-xs text-slate-200 truncate ${mono ? 'font-mono' : ''}`}>{value}</div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800/80 col-span-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Location · Network · Merchant</div>
                      <div className="text-xs text-slate-200 font-mono">
                        <span className="text-slate-300">{selectedTxRaw?.location?.city ?? '—'}</span>
                        <span className="text-slate-600 mx-1.5">·</span>
                        <span className="text-slate-400">{selectedTxRaw?.network_type ?? '—'}</span>
                        <span className="text-slate-600 mx-1.5">·</span>
                        <span className="text-slate-500">{selectedTxRaw?.merchant_id ?? '—'}</span>
                      </div>
                      {selectedTxRaw?.device_id && (
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">
                          Device: <span className="text-slate-400">{selectedTxRaw.device_id}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-8 mb-8">
                  <div className="relative w-48 h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadialBarChart 
                        cx="50%" 
                        cy="50%" 
                        innerRadius="10%" 
                        outerRadius="100%" 
                        barSize={10} 
                        data={[
                          { name: 'Geo', score: selectedTx.component_scores.geo_risk, fill: '#10b981' },
                          { name: 'Velocity', score: selectedTx.component_scores.velocity_risk, fill: '#3b82f6' },
                          { name: 'Device', score: selectedTx.component_scores.device_risk, fill: '#f59e0b' },
                          { name: 'Amount', score: selectedTx.component_scores.amount_risk, fill: '#ef4444' },
                          { name: 'Network', score: selectedTx.component_scores.network_risk, fill: '#8b5cf6' },
                          { name: 'Behavior', score: selectedTx.component_scores.behavioral_risk, fill: '#ec4899' },
                        ]}
                        startAngle={180} 
                        endAngle={0}
                      >
                        <RadialBar
                          label={{ position: 'insideStart', fill: '#fff' }}
                          background
                          dataKey="score"
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
                          itemStyle={{ color: '#f8fafc' }}
                        />
                      </RadialBarChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none mt-8">
                      <span className={cn("text-3xl font-bold font-mono", selectedTx.final_risk_score >= 70 ? "text-rose-500" : selectedTx.final_risk_score >= 40 ? "text-amber-500" : "text-emerald-500")}>
                        {selectedTx.final_risk_score}
                      </span>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">Risk Score</span>
                    </div>
                  </div>

                  <div className="flex-1 grid grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">Processing Time</div>
                      <div className="text-xl font-mono text-emerald-400">{selectedTx.processing_time_ms.toFixed(2)}ms</div>
                    </div>
                    <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">Risk Factors</div>
                      <div className="text-xl font-mono text-white">{selectedTx.reasoning.length}</div>
                    </div>
                    <div className="col-span-2 h-24 bg-slate-950/50 rounded-lg border border-slate-800 p-2">
                       <div className="text-[10px] text-slate-500 mb-1 uppercase">User Activity (Last 20 Txns)</div>
                       <ResponsiveContainer width="100%" height="100%">
                         <AreaChart data={engine.getHistory(selectedTx.user_id).slice(-20)}>
                           <defs>
                             <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                               <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                               <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                             </linearGradient>
                           </defs>
                           <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                           <Tooltip 
                             contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '10px' }}
                             itemStyle={{ color: '#10b981' }}
                           />
                           <Area type="monotone" dataKey="amount" stroke="#10b981" fillOpacity={1} fill="url(#colorAmount)" strokeWidth={1} />
                         </AreaChart>
                       </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* Risk Breakdown */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Engine Breakdown</h3>
                  {[
                    { label: 'Geo Risk', score: selectedTx.component_scores.geo_risk, icon: Globe },
                    { label: 'Velocity Risk', score: selectedTx.component_scores.velocity_risk, icon: Activity },
                    { label: 'Device Risk', score: selectedTx.component_scores.device_risk, icon: Smartphone },
                    { label: 'Amount Risk', score: selectedTx.component_scores.amount_risk, icon: CreditCard },
                    { label: 'Network Risk', score: selectedTx.component_scores.network_risk, icon: Wifi },
                    { label: 'Behavioral Risk', score: selectedTx.component_scores.behavioral_risk, icon: User },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-4 p-2 rounded hover:bg-slate-800/50 transition-colors">
                      <item.icon className="w-4 h-4 text-slate-500" />
                      <div className="flex-1 flex justify-between items-center">
                        <span className="text-sm text-slate-300">{item.label}</span>
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div 
                              className={cn(
                                'h-full rounded-full transition-all duration-500',
                                item.score >= 70 ? 'bg-rose-500' : item.score >= 40 ? 'bg-amber-400' : item.score > 0 ? 'bg-emerald-400' : 'bg-slate-700'
                              )}
                              style={{ width: `${Math.min(item.score, 100)}%` }}
                            ></div>
                          </div>
                          <span className="text-xs font-mono w-8 text-right text-slate-400">{item.score}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Badges: latency_breach, coordinated_attack, escalation_override */}
                {(selectedTx.latency_breach || selectedTx.coordinated_attack || selectedTx.escalation_override) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedTx.latency_breach && (
                      <span className="px-2 py-0.5 rounded text-xs font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">⚠ LATENCY BREACH</span>
                    )}
                    {selectedTx.coordinated_attack && (
                      <span className="px-2 py-0.5 rounded text-xs font-mono bg-rose-500/10 text-rose-400 border border-rose-500/20">⚠ COORDINATED ATTACK</span>
                    )}
                    {selectedTx.escalation_override && (
                      <span className="px-2 py-0.5 rounded text-xs font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20">⚠ ESCALATION OVERRIDE</span>
                    )}
                  </div>
                )}

                {/* Reason Code */}
                {'reason_code' in selectedTx && selectedTx.reason_code && selectedTx.reason_code !== 'OK' && (
                  <div className="mt-3 flex items-center gap-2 p-2 bg-slate-950/60 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Reason Code</span>
                    <span className="text-xs font-mono text-rose-300">{(selectedTx as any).reason_code}</span>
                  </div>
                )}

                {/* Reasoning */}
                {selectedTx.reasoning.length > 0 && (
                  <div className="mt-6 p-4 bg-rose-500/5 border border-rose-500/10 rounded-lg">
                    <h4 className="text-xs font-bold text-rose-400 uppercase mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-3 h-3" /> Risk Flags Detected
                    </h4>
                    <ul className="space-y-1">
                      {selectedTx.reasoning.map((reason, idx) => (
                        <li key={idx} className="text-sm text-rose-200/80 pl-4 border-l-2 border-rose-500/30">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Power Boost */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400">⚡ Power Boost</span>
                  </h3>
                  <button 
                    onClick={() => analyzeWithGemini(selectedTx)}
                    disabled={isAnalyzing}
                    className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-md transition-colors flex items-center gap-2"
                  >
                    {isAnalyzing ? 'Analyzing...' : <><FileText className="w-3 h-3" /> Generate Summary</>}
                  </button>
                </div>
                {geminiAnalysis ? (
                  <div className="text-sm text-slate-300 leading-relaxed animate-in fade-in slide-in-from-bottom-2">
                    {geminiAnalysis}
                  </div>
                ) : (
                  <div className="text-xs text-slate-600 italic">
                    Click "Generate Summary" to ask Gemini to analyze this transaction report.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center justify-center text-slate-600 p-12 min-h-[320px]">
              <Shield className="w-12 h-12 mb-4 text-slate-700" />
              <p className="text-sm font-medium text-slate-500">No transaction selected</p>
              <p className="text-xs mt-1 text-slate-600">Pick one from the stream or start the simulation</p>
            </div>
          )}
        </div>

        {/* Right Column: Ledger & Tools */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Ledger */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[500px]">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900 sticky top-0">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Lock className="w-3 h-3" /> Immutable Ledger
              </h2>
              <div className="flex items-center gap-1 text-[10px] text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                <CheckCircle className="w-3 h-3" /> VERIFIED
              </div>
            </div>
            <div className="overflow-y-auto p-2 space-y-2 custom-scrollbar flex-1">
              {ledgerChain.slice().reverse().map((entry) => (
                <div key={entry.index} className="p-3 bg-slate-950 rounded border border-slate-800/50 text-xs font-mono group hover:border-slate-700 transition-colors">
                  <div className="flex justify-between text-slate-500 mb-1">
                    <span>#{entry.index}</span>
                    <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="truncate text-slate-400 mb-1" title={entry.current_hash}>
                    Hash: <span className="text-slate-600">{entry.current_hash.substring(0, 16)}...</span>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-[10px]",
                      entry.decision === 'BLOCK' ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'
                    )}>
                      {entry.decision}
                    </span>
                    <span className="text-slate-600">Score: {entry.final_risk_score}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Visualization Tool */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <ImageIcon className="w-4 h-4" /> Fraud Visualization
            </h3>
            
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-[10px] text-slate-500 uppercase block mb-1">Aspect Ratio</label>
                <select 
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-300"
                >
                  <option value="1:1">1:1</option>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="4:3">4:3</option>
                  <option value="3:4">3:4</option>
                </select>
              </div>
              
              <button 
                onClick={generateFraudVisualization}
                disabled={isGeneratingImage}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-2 rounded transition-colors disabled:opacity-50"
              >
                {isGeneratingImage ? 'Generating...' : 'Generate Report Visual'}
              </button>
            </div>

            {generatedImageUrl && (
              <div className="rounded-lg overflow-hidden border border-slate-800 relative group">
                <img src={generatedImageUrl} alt="Fraud Visualization" className="w-full h-auto" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <a href={generatedImageUrl} download="fraud-report.png" className="text-white text-xs underline">Download</a>
                </div>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
