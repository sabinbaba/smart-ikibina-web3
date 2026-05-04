import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESS, ABI, LOAN_STATUS } from './contracts/config';
import './App.css';

// ── Toast helper ──────────────────────────────────────
let _toastId = 0;
function useToast() {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((msg, type = 'info') => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);
  return { toasts, show };
}

// ── Utilities ─────────────────────────────────────────
const fmt  = (wei)  => parseFloat(ethers.formatEther(wei || 0)).toFixed(4);
const fmtN = (n)    => Number(n || 0).toString();
const shortAddr = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
const daysLeft = (deadline) => {
  const d = Math.ceil((Number(deadline) * 1000 - Date.now()) / 86400000);
  return d > 0 ? `${d}d left` : 'Overdue';
};
const termProgress = (start, end) => {
  const now = Date.now() / 1000;
  const pct = Math.min(100, ((now - Number(start)) / (Number(end) - Number(start))) * 100);
  return Math.max(0, pct).toFixed(1);
};

// ── Main App ──────────────────────────────────────────
export default function App() {
  const { toasts, show } = useToast();

  // Wallet
  const [account,   setAccount]   = useState(null);
  const [isAdmin,   setIsAdmin]   = useState(false);
  const [loading,   setLoading]   = useState(false);

  // Contract data
  const [member,       setMember]       = useState(null);
  const [loan,         setLoan]         = useState(null);
  const [term,         setTerm]         = useState(null);
  const [totalPool,    setTotalPool]    = useState('0');
  const [reservePool,  setReservePool]  = useState('0');
  const [memberCount,  setMemberCount]  = useState('0');
  const [contractBal,  setContractBal]  = useState('0');
  const [pendingReqs,  setPendingReqs]  = useState([]);

  // Navigation state
  const [currentPage, setCurrentPage] = useState('profile');
  const [regName,      setRegName]      = useState('');
  const [regEmail,     setRegEmail]     = useState('');
  const [regPhone,     setRegPhone]     = useState('');
  const [regWallet,    setRegWallet]    = useState('');
  const [depositAmt,   setDepositAmt]   = useState('');
  const [withdrawAmt,  setWithdrawAmt]  = useState('');
  const [loanAmt,      setLoanAmt]      = useState('');
  const [repayAmt,     setRepayAmt]     = useState('');

  // ── Helpers ──────────────────────────────────────────
  const getProvider = () => new ethers.BrowserProvider(window.ethereum);
  const getContract = async (write = false) => {
    const provider = getProvider();
    const runner   = write ? await provider.getSigner() : provider;
    return new ethers.Contract(CONTRACT_ADDRESS, ABI, runner);
  };

  const tx = async (fn, successMsg) => {
    setLoading(true);
    try {
      const t = await fn();
      show('Transaction sent — waiting…', 'info');
      await t.wait();
      show(successMsg, 'success');
      // pass account explicitly so refreshAll doesn't rely on stale closure
      await refreshAll(account);
    } catch (e) {
      // parse the revert reason cleanly
      const reason =
        e.reason ||
        e.error?.message ||
        e.message?.match(/execution reverted: (.+?)"/)?.[1] ||
        e.message?.slice(0, 160) ||
        'Transaction failed';
      show(reason, 'error');
    } finally {
      setLoading(false);
    }
  };

  // ── Data Refresh ──────────────────────────────────────
  const refreshAll = useCallback(async (addr) => {
    const wallet = addr || account;
    if (!wallet || !window.ethereum) return;
    try {
      const c = await getContract();

      // 1. Public / view-only calls — safe for anyone
      const [adminAddr, pool, reserve, mCount, bal, termData] = await Promise.all([
        c.admin(),
        c.totalPool(),
        c.reservePool(),
        c.memberCount(),
        c.contractBalance(),
        c.getCurrentTerm(),
      ]);

      setIsAdmin(adminAddr.toLowerCase() === wallet.toLowerCase());
      setTotalPool(fmt(pool));
      setReservePool(fmt(reserve));
      setMemberCount(fmtN(mCount));
      setContractBal(fmt(bal));
      setTerm(termData);

      // 2. getMember is safe for everyone — returns empty struct if not registered
      const m = await c.getMember(wallet);
      const registered = m.isRegistered && m.isActive;
      setMember(registered ? m : null);

      // 3. getLoan — only call if the wallet is a registered active member
      //    (the contract modifier onlyMember will revert otherwise)
      if (registered) {
        const l = await c.getLoan(wallet);
        setLoan(l);
      } else {
        setLoan(null);
      }

      // 4. Pending loan requests — only needed for admin, safe to call
      //    getLoanRequest reads public mapping, no modifier, always safe
      const reqCount = Number(await c.loanRequestCount());
      if (reqCount > 0) {
        const reqs = [];
        for (let i = reqCount - 1; i >= Math.max(0, reqCount - 20); i--) {
          try {
            const r = await c.getLoanRequest(i);
            if (!r.approved && !r.rejected) reqs.push({ id: i, ...r });
          } catch (_) { /* skip bad entries */ }
        }
        setPendingReqs(reqs);
      }

    } catch (e) {
      console.error('refreshAll error:', e);
    }
  }, [account]);

  // ── Connect Wallet ────────────────────────────────────
  const connectWallet = async () => {
    if (!window.ethereum) { show('MetaMask not detected', 'error'); return; }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0]);
      await refreshAll(accounts[0]);
    } catch (e) {
      show('Connection rejected', 'error');
    }
  };

  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum.on('accountsChanged', (accs) => {
      setAccount(accs[0] || null);
      if (accs[0]) refreshAll(accs[0]);
    });
  }, [refreshAll]);

  // ── Transactions ──────────────────────────────────────
  const handleRegister = () => {
    if (!isAdmin) {
      show('Only admin can register members', 'error');
      return;
    }
    tx(
      async () => (await getContract(true)).register(regName, regEmail, regPhone, regWallet),
      `Registered ${shortAddr(regWallet)} successfully!`
    );
  };

  const handleContribute = () => tx(
    async () => (await getContract(true)).contribute({ value: ethers.parseEther(depositAmt || '0') }),
    'Contribution successful!'
  );

  const handleWithdraw = () => tx(
    async () => (await getContract(true)).withdrawSavings(ethers.parseEther(withdrawAmt || '0')),
    'Withdrawal successful!'
  );

  const handleRequestLoan = () => tx(
    async () => (await getContract(true)).requestLoan(ethers.parseEther(loanAmt || '0')),
    'Loan request submitted!'
  );

  const handleRepay = () => tx(
    async () => (await getContract(true)).repayLoan({ value: ethers.parseEther(repayAmt || '0') }),
    'Repayment successful!'
  );

  const handleClaimDividends = () => tx(
    async () => (await getContract(true)).claimDividends(),
    'Dividends claimed!'
  );

  const handleDistributeDividends = () => tx(
    async () => (await getContract(true)).distributeDividends(),
    'Dividends distributed!'
  );

  const handleApproveLoan = (id) => tx(
    async () => (await getContract(true)).approveLoan(id),
    `Loan #${id} approved!`
  );

  const handleRejectLoan = (id) => tx(
    async () => (await getContract(true)).rejectLoan(id),
    `Loan #${id} rejected.`
  );

  // ── Derived ──────────────────────────────────────────
  const loanStatusKey = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';
  const maxLoan       = member ? fmt(BigInt(member.savings) * 3n) : '0';
  const hasDividends  = member && BigInt(member.pendingDividends || 0) > 0n;
  const termPct       = term ? termProgress(term.startTime, term.endTime) : 0;

  // ── Render ────────────────────────────────────────────
  if (!account) {
    return (
      <div className="app-container">
        <nav className="header">
          <div className="header-brand">
            <h1>Ikimina</h1>
            <span>Web3 Savings</span>
          </div>
        </nav>
        <div className="connect-screen">
          <div className="connect-logo">🏦</div>
          <h2>Community Savings Pool</h2>
          <p>Save together, borrow smart. Connect your wallet to join the Ikimina savings group.</p>
          <button className="connect-btn-large" onClick={connectWallet}>
            Connect Wallet
          </button>
        </div>
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  return (
    <div className="dashboard-layout">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-brand">
          <h1>Ikimina</h1>
          <span>Web3 Savings</span>
        </div>
        <div className="header-actions">
          {isAdmin && <span className="admin-badge">⚙ Admin</span>}
          <span className="network-badge">Sepolia</span>
          <button className="btn-primary" onClick={connectWallet} disabled={loading}>
            {account ? shortAddr(account) : 'Connect'}
            {loading && <span className="spinner" />}
          </button>
        </div>
      </header>

      <div className="dashboard-main">
        {/* Sidebar */}
        <aside className="dashboard-sidebar">
          <nav className="sidebar-nav">
            <SidebarLink href="#profile" active={currentPage === 'profile'} onClick={() => setCurrentPage('profile')}>
              👤 Profile
            </SidebarLink>
            <SidebarLink href="#savings" active={currentPage === 'savings'} onClick={() => setCurrentPage('savings')}>
              💰 Savings
            </SidebarLink>
            <SidebarLink href="#loans" active={currentPage === 'loans'} onClick={() => setCurrentPage('loans')}>
              📈 Loans
            </SidebarLink>
            <SidebarLink href="#dividends" active={currentPage === 'dividends'} onClick={() => setCurrentPage('dividends')}>
              📊 Dividends
            </SidebarLink>
            {isAdmin && (
              <SidebarLink href="#admin" active={currentPage === 'admin'} onClick={() => setCurrentPage('admin')}>
                ⚙ Admin
              </SidebarLink>
            )}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="dashboard-content">
          {/* Profile Page */}
          {currentPage === 'profile' && (
            <div className="page-section">
              <h1>Profile</h1>
              {member && (
                <div className="member-profile-card">
                  <div className="profile-avatar">{member.name?.charAt(0).toUpperCase()}</div>
                  <div className="profile-info">
                    <div className="profile-name">{member.name}</div>
                    <div className="profile-meta">
                      <span>✉ {member.email}</span>
                      <span>📞 {member.phone}</span>
                    </div>
                  </div>
                  <div className="profile-wallet">
                    <div className="profile-wallet-label">Wallet Address</div>
                    <div className="profile-wallet-addr">
                      <span className="wallet-full">{account}</span>
                      <button className="copy-btn" onClick={() => navigator.clipboard.writeText(account) && show('Copied!')} title="Copy">
                        ⎘
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className="stats-grid">
                <div className="stat-card" style={{'--accent-color': 'var(--gold)'}}>
                  <div className="stat-label">My Savings</div>
                  <div className="stat-value gold">{member ? fmt(member.savings) : '—'} ETH</div>
                  <div className="stat-sub">Max loan: {maxLoan} ETH</div>
                </div>
                <div className="stat-card" style={{'--accent-color': 'var(--green)'}}>
                  <div className="stat-label">Total Pool</div>
                  <div className="stat-value green">{totalPool} ETH</div>
                  <div className="stat-sub">Reserve: {reservePool} ETH</div>
                </div>
                <div className="stat-card" style={{'--accent-color': 'var(--blue)'}}>
                  <div className="stat-label">Loan Status</div>
                  <div style={{marginTop: '0.4rem'}}>
                    <span className={`loan-status ${loanStatusKey}`}>
                      {LOAN_STATUS[Number(loan?.status)] || 'None'}
                    </span>
                  </div>
                </div>
                <div className="stat-card" style={{'--accent-color': 'var(--amber)'}}>
                  <div className="stat-label">Pending Dividends</div>
                  <div className="stat-value amber">{member ? fmt(member.pendingDividends) : '—'} ETH</div>
                  <div className="stat-sub">Members: {memberCount}</div>
                </div>
              </div>
            </div>
          )}

          {/* Savings Page */}
          {currentPage === 'savings' && (
            <div className="page-section">
              <h1>Savings</h1>
              {term && (
                <div className="action-card" style={{marginBottom: '1.25rem'}}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem'}}>
                    <span style={{fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '0.95rem'}}>Term #{fmtN(term.termId)}</span>
                    <span className={`loan-status ${term.distributed ? 'repaid' : 'active'}`}>
                      {term.distributed ? 'Distributed' : 'Active'}
                    </span>
                  </div>
                  <div className="term-bar-wrap">
                    <div className="term-bar-label">
                      <span>Progress</span>
                      <span>{termPct}%</span>
                    </div>
                    <div className="term-bar">
                      <div className="term-bar-fill" style={{width: `${termPct}%`}} />
                    </div>
                  </div>
                </div>
              )}
              <div className="actions-section">
                <div className="action-card">
                  <h2>Add Savings</h2>
                  <p className="card-desc">Contribute ETH to the pool. Minimum 0.001 ETH.</p>
                  <div className="input-group">
                    <label>Amount (ETH)</label>
                    <input type="number" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} placeholder="0.05" min="0.001" step="0.001" />
                  </div>
                  <button className="btn-full" onClick={handleContribute} disabled={loading || !depositAmt}>
                    {loading ? <span className="spinner" /> : 'Deposit to Pool'}
                  </button>
                </div>
                <div className="action-card">
                  <h2>Withdraw Savings</h2>
                  <p className="card-desc">Withdraw your savings. No active loan required.</p>
                  <div className="input-group">
                    <label>Amount (ETH)</label>
                    <input type="number" value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} placeholder="0.01" min="0.001" step="0.001" />
                  </div>
                  <div style={{fontSize: '0.75rem', color: 'var(--text-3)', marginBottom: '0.5rem'}}>
                    Available: {fmt(member?.savings)} ETH
                  </div>
                  <button className="btn-danger" onClick={handleWithdraw} disabled={loading || !withdrawAmt || loanStatusKey === 'active'}>
                    {loanStatusKey === 'active' ? 'Repay loan first' : loading ? <span className="spinner" /> : 'Withdraw'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Loans Page */}
          {currentPage === 'loans' && (
            <div className="page-section">
              <h1>Loans</h1>
              <div className="actions-section">
                <div className="action-card">
                  <h2>Request a Loan</h2>
                  <p className="card-desc">Borrow up to 3× savings at 5% interest. Admin approval required.</p>
                  {loanStatusKey === 'active' || loanStatusKey === 'pending' ? (
                    <div className="loan-info">
                      <div className="loan-info-row"><span>Principal</span><span>{fmt(loan.principal)} ETH</span></div>
                      <div className="loan-info-row"><span>Total Owed</span><span>{fmt(loan.totalOwed)} ETH</span></div>
                      <div className="loan-info-row"><span>Repaid</span><span>{fmt(loan.amountRepaid)} ETH</span></div>
                      <div className="loan-info-row"><span>Remaining</span><span style={{color: 'var(--red)'}}>{fmt(loan.remainingOwed)} ETH</span></div>
                    </div>
                  ) : (
                    <>
                      <div className="input-group">
                        <label>Loan Amount (ETH)</label>
                        <input type="number" value={loanAmt} onChange={(e) => setLoanAmt(e.target.value)} placeholder="0.1" min="0" step="0.001" />
                      </div>
                      <div style={{fontSize: '0.75rem', color: 'var(--text-3)', marginBottom: '0.5rem'}}>
                        Max: {maxLoan} ETH · 5% interest · 30 days
                      </div>
                      <button className="btn-full" onClick={handleRequestLoan} disabled={loading || !loanAmt || parseFloat(loanAmt) > parseFloat(maxLoan)}>
                        {loading ? <span className="spinner" /> : 'Request Loan'}
                      </button>
                    </>
                  )}
                </div>
                <div className="action-card">
                  <h2>Repay Loan</h2>
                  <p className="card-desc">Partial or full repayment. Overpayment refunded.</p>
                  <div className="input-group">
                    <label>Repayment Amount (ETH)</label>
                    <input type="number" value={repayAmt} onChange={(e) => setRepayAmt(e.target.value)} placeholder="0.105" min="0" step="0.001" disabled={loanStatusKey !== 'active'} />
                  </div>
                  {loanStatusKey === 'active' && (
                    <div style={{fontSize: '0.75rem', color: 'var(--text-3)', marginBottom: '0.5rem'}}>
                      Remaining: {fmt(loan.remainingOwed)} ETH
                    </div>
                  )}
                  <button className="btn-green" onClick={handleRepay} disabled={loading || loanStatusKey !== 'active' || !repayAmt}>
                    {loanStatusKey !== 'active' ? 'No Active Loan' : loading ? <span className="spinner" /> : 'Repay'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Dividends Page */}
          {currentPage === 'dividends' && (
            <div className="page-section">
              <h1>Dividends</h1>
              <div className="actions-section">
                <div className="action-card">
                  <h2>Your Dividends</h2>
                  <p className="card-desc">80% of term interest distributed pro-rata.</p>
                  <div className="loan-info">
                    <div className="loan-info-row"><span>Pending</span><span style={{color: 'var(--amber)'}}>{fmt(member.pendingDividends)} ETH</span></div>
                    <div className="loan-info-row"><span>Savings</span><span>{fmt(member.savings)} ETH</span></div>
                    <div className="loan-info-row"><span>Term Interest</span><span>{term ? fmt(term.interestCollected) : '—'} ETH</span></div>
                  </div>
                  <button className="btn-full" onClick={handleClaimDividends} disabled={loading || !hasDividends}>
                    {!hasDividends ? 'No Dividends' : loading ? <span className="spinner" /> : 'Claim'}
                  </button>
                </div>
                <div className="action-card">
                  <h2>Distribute Dividends</h2>
                  <p className="card-desc">Trigger distribution at term end.</p>
                  {term && (
                    <div className="loan-info">
                      <div className="loan-info-row"><span>Term Ends</span><span>{new Date(Number(term.endTime) * 1000).toLocaleDateString()}</span></div>
                      <div className="loan-info-row"><span>Progress</span><span>{termPct}%</span></div>
                    </div>
                  )}
                  <button className="btn-full" onClick={handleDistributeDividends} disabled={loading || !term || term.distributed || termPct < 100}>
                    {term?.distributed ? 'Done' : termPct < 100 ? `Term ${termPct}%` : loading ? <span className="spinner" /> : 'Distribute'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Admin Page */}
          {currentPage === 'admin' && (
            <div className="page-section">
              <h1>Admin Panel</h1>
              <div className="action-card">
                <h2>Register Member</h2>
                <div className="register-form">
                  <div className="input-group">
                    <label>Wallet Address</label>
                    <input value={regWallet} onChange={(e) => setRegWallet(e.target.value)} placeholder="0x123..." />
                  </div>
                  <div className="input-group">
                    <label>Name</label>
                    <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="John Doe" />
                  </div>
                  <div className="input-group">
                    <label>Email</label>
                    <input value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="john@example.com" />
                  </div>
                  <div className="input-group">
                    <label>Phone</label>
                    <input value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="+1 555 1234" />
                  </div>
                </div>
                <button className="btn-full" onClick={handleRegister} disabled={loading || !regWallet || !regName || !regEmail || !regPhone}>
                  {loading ? <span className="spinner" /> : 'Register'}
                </button>
              </div>
              <div className="pending-requests">
                <h2>Pending Loans ({pendingReqs.length})</h2>
                {pendingReqs.length === 0 ? (
                  <div className="empty-state">No pending requests</div>
                ) : (
                  pendingReqs.map(r => (
                    <div key={r.id} className="request-card">
                      <div className="request-info">
                        <div>{shortAddr(r.borrower)}</div>
                        <div>{fmt(r.amount)} ETH</div>
                      </div>
                      <div className="request-actions">
                        <button className="btn-approve" onClick={() => handleApproveLoan(r.id)}>Approve</button>
                        <button className="btn-reject" onClick={() => handleRejectLoan(r.id)}>Reject</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="dashboard-footer">
        <div className="footer-content">
          <span>Contract: {shortAddr(CONTRACT_ADDRESS)}</span>
          <span>Sepolia Testnet</span>
        </div>
      </footer>

      <ToastContainer toasts={toasts} />
    </div>
  );
}

// ── Sidebar Link Component ─────────────────────────────
function SidebarLink({ href, active, onClick, children }) {
  return (
    <a 
      href={href} 
      className={`sidebar-link ${active ? 'active' : ''}`} 
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {children}
    </a>
  );
}

// ── Toast UI ──────────────────────────────────────────
function ToastContainer({ toasts }) {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span>{icons[t.type]}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
