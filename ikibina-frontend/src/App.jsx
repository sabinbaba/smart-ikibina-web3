import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESS, ABI, LOAN_STATUS } from './contracts/config';
import './App.css';

// ── Constants - Using Integer Math for Perfect Precision ──
const ETH_RWF_RATE = 8500000; // 1 ETH = 8,500,000 RWF
const WEI_PER_ETH = 1000000000000000000n; // 10^18
const WEI_PER_RWF = WEI_PER_ETH / BigInt(ETH_RWF_RATE); // 117647058823529 wei per RWF

// ── Toast helper ──────────────────────────────────────
let _toastId = 0;
function useToast() {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((msg, type = 'info') => {
    const id = ++_toastId;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }, []);
  return { toasts, show };
}

// ── Utilities - NO FLOATING POINT DISCREPANCIES ──────────
const fmtETH = (wei) => {
  if (!wei) return '0';
  return (Number(wei) / Number(WEI_PER_ETH)).toFixed(8);
};

const fmtRWF = (wei) => {
  if (!wei) return '0';
  const weiBig = BigInt(wei);
  const rwf = weiBig / WEI_PER_RWF;
  return rwf.toString();
};

const fmtRWFDisplay = (wei) => {
  if (!wei) return '0';
  const weiBig = BigInt(wei);
  const rwf = weiBig / WEI_PER_RWF;
  return Number(rwf).toLocaleString();
};

const rwfToWei = (rwfAmount) => {
  if (!rwfAmount || parseFloat(rwfAmount) <= 0) return 0n;
  const rwf = BigInt(Math.floor(parseFloat(rwfAmount)));
  return rwf * WEI_PER_RWF;
};

const rwfToEthString = (rwfAmount) => {
  const wei = rwfToWei(rwfAmount);
  return (Number(wei) / Number(WEI_PER_ETH)).toFixed(10);
};

const shortAddr = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
const termProgress = (start, end) => {
  const now = Date.now() / 1000;
  const pct = Math.min(100, ((now - Number(start)) / (Number(end) - Number(start))) * 100);
  return Math.max(0, pct).toFixed(1);
};

// ── Main App ──────────────────────────────────────────
export default function App() {
  const { toasts, show } = useToast();

  // Wallet
  const [account, setAccount] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ethBalance, setEthBalance] = useState('0');

  // Contract data
  const [member, setMember] = useState(null);
  const [loan, setLoan] = useState(null);
  const [term, setTerm] = useState(null);
  const [totalPool, setTotalPool] = useState('0');
  const [reservePool, setReservePool] = useState('0');
  const [memberCount, setMemberCount] = useState('0');
  const [contractBal, setContractBal] = useState('0');
  const [pendingReqs, setPendingReqs] = useState([]);
  
  // Member directory
  const [allMembers, setAllMembers] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Navigation state
  const [currentPage, setCurrentPage] = useState('profile');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regWallet, setRegWallet] = useState('');
  
  // RWF denominated amounts
  const [depositRwf, setDepositRwf] = useState('');
  const [withdrawRwf, setWithdrawRwf] = useState('');
  const [loanRwf, setLoanRwf] = useState('');
  const [repayRwf, setRepayRwf] = useState('');

  // ── Helpers ──────────────────────────────────────────
  const getProvider = () => new ethers.BrowserProvider(window.ethereum);
  const getContract = async (write = false) => {
    const provider = getProvider();
    const runner = write ? await provider.getSigner() : provider;
    return new ethers.Contract(CONTRACT_ADDRESS, ABI, runner);
  };

  // ── Fetch all members from contract ──────────────────
  const fetchAllMembers = useCallback(async () => {
    if (!account || !window.ethereum) return;
    
    setLoadingMembers(true);
    try {
      const c = await getContract();
      
      // Get member list from contract
      const memberAddresses = await c.getMemberList();
      console.log('Member addresses from contract:', memberAddresses);
      console.log('Number of members:', memberAddresses.length);
      
      if (!memberAddresses || memberAddresses.length === 0) {
        console.log('No members found in contract');
        setAllMembers([]);
        setLoadingMembers(false);
        return;
      }
      
      const membersData = [];
      
      for (const addr of memberAddresses) {
        try {
          const m = await c.getMember(addr);
          console.log(`Fetching member ${addr}:`, m);
          
          if (m && m.isRegistered) {
            let loanData = { status: 0, principal: 0, totalOwed: 0, amountRepaid: 0 };
            try {
              loanData = await c.getLoan(addr);
            } catch (err) {
              // No loan or error, use defaults
            }
            
            membersData.push({
              address: addr,
              name: m.name,
              email: m.email,
              phone: m.phone,
              isActive: m.isActive,
              savings: m.savings,
              pendingDividends: m.pendingDividends,
              joinedAt: m.joinedAt,
              hasActiveLoan: loanData.status === 1 || loanData.status === 2,
              loanAmount: loanData.principal,
              loanStatus: loanData.status,
              loanTotalOwed: loanData.totalOwed,
              loanAmountRepaid: loanData.amountRepaid
            });
          }
        } catch (err) {
          console.error(`Error fetching member ${addr}:`, err);
        }
      }
      
      console.log('Final members data:', membersData);
      setAllMembers(membersData);
      
    } catch (err) {
      console.error('Error fetching members:', err);
      setAllMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, [account, getContract]);

  // ── Validate RWF amount based on transaction type ──────────
  const validateRwfAmount = (amount, type = 'deposit') => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return { valid: false, error: 'Please enter a valid amount in RWF' };
    }
    
    const weiAmount = rwfToWei(amount);
    const ethAmount = Number(weiAmount) / Number(WEI_PER_ETH);
    const minEth = 0.001;
    const minRwf = Math.ceil(minEth * ETH_RWF_RATE);
    
    // DEPOSIT / CONTRIBUTION - minimum check applies
    if (type === 'deposit') {
      if (ethAmount < minEth - 0.0000001) {
        return { 
          valid: false, 
          error: `Minimum contribution is ${minRwf.toLocaleString()} RWF` 
        };
      }
      return { valid: true, rwf: numAmount, wei: weiAmount, eth: ethAmount };
    }
    
    // REPAY - no minimum, but must have active loan
    if (type === 'repay') {
      const loanStatusKey = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';
      if (loanStatusKey !== 'active') {
        return { valid: false, error: 'No active loan to repay' };
      }
      if (loan && loanStatusKey === 'active') {
        const remainingWei = BigInt(loan.remainingOwed);
        const remainingRwf = Number(remainingWei / WEI_PER_RWF);
        if (numAmount > remainingRwf) {
          return { 
            valid: false, 
            error: `Amount exceeds remaining loan of ${remainingRwf.toLocaleString()} RWF` 
          };
        }
      }
      return { valid: true, rwf: numAmount, wei: weiAmount, eth: ethAmount };
    }
    
    // WITHDRAW - must have sufficient balance
    if (type === 'withdraw') {
      if (!member) {
        return { valid: false, error: 'Not a registered member' };
      }
      const savingsWei = BigInt(member.savings);
      if (weiAmount > savingsWei) {
        return { valid: false, error: 'Insufficient savings balance' };
      }
      const loanStatusKey = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';
      if (loanStatusKey === 'active') {
        return { valid: false, error: 'Repay active loan first before withdrawing' };
      }
      return { valid: true, rwf: numAmount, wei: weiAmount, eth: ethAmount };
    }
    
    // LOAN REQUEST - must be within limit
    if (type === 'loan') {
      if (!member) {
        return { valid: false, error: 'Not a registered member' };
      }
      const maxLoanWei = BigInt(member.savings) * 3n;
      if (weiAmount > maxLoanWei) {
        const maxLoanRwf = Number(maxLoanWei / WEI_PER_RWF);
        return { valid: false, error: `Maximum loan is ${maxLoanRwf.toLocaleString()} RWF` };
      }
      const loanStatusKey = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';
      if (loanStatusKey === 'active' || loanStatusKey === 'pending') {
        return { valid: false, error: 'You already have an active or pending loan' };
      }
      return { valid: true, rwf: numAmount, wei: weiAmount, eth: ethAmount };
    }
    
    return { valid: false, error: 'Invalid transaction type' };
  };

  const tx = async (fn, successMsg, valueWei = null) => {
    setLoading(true);
    try {
      let txPromise;
      if (valueWei !== null) {
        txPromise = fn(valueWei);
      } else {
        txPromise = fn();
      }
      
      const t = await txPromise;
      show('Transaction sent — waiting…', 'info');
      await t.wait();
      show(successMsg, 'success');
      await refreshAll(account);
    } catch (e) {
      const reason = e.reason ||
        e.error?.message ||
        e.message?.match(/execution reverted: (.+?)"/)?.[1] ||
        e.message?.slice(0, 160) ||
        'Transaction failed';
      show(reason, 'error');
      console.error('Transaction error:', e);
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
      const provider = getProvider();
      
      const balance = await provider.getBalance(wallet);
      setEthBalance(ethers.formatEther(balance));

      const [adminAddr, pool, reserve, mCount, bal, termData] = await Promise.all([
        c.admin(),
        c.totalPool(),
        c.reservePool(),
        c.memberCount(),
        c.contractBalance(),
        c.getCurrentTerm(),
      ]);

      setIsAdmin(adminAddr && adminAddr.toLowerCase() === wallet.toLowerCase());
      setTotalPool(fmtETH(pool));
      setReservePool(fmtETH(reserve));
      setMemberCount(Number(mCount).toString());
      setContractBal(fmtETH(bal));
      setTerm(termData);

      const m = await c.getMember(wallet);
      const registered = m && m.isRegistered && m.isActive;
      setMember(registered ? m : null);

      if (registered) {
        try {
          const l = await c.getLoan(wallet);
          setLoan(l);
        } catch (err) {
          setLoan(null);
        }
      } else {
        setLoan(null);
      }

      const reqCount = Number(await c.loanRequestCount());
      if (reqCount > 0) {
        const reqs = [];
        for (let i = reqCount - 1; i >= Math.max(0, reqCount - 20); i--) {
          try {
            const r = await c.getLoanRequest(i);
            if (r && !r.approved && !r.rejected) {
              reqs.push({ id: i, ...r });
            }
          } catch (_) { }
        }
        setPendingReqs(reqs);
      }
      
      // Fetch all members after getting contract data
      await fetchAllMembers();
      
    } catch (e) {
      console.error('refreshAll error:', e);
    }
  }, [account, fetchAllMembers]);

  // ── Connect Wallet ────────────────────────────────────
  const connectWallet = async () => {
    if (!window.ethereum) {
      show('MetaMask not detected', 'error');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0]);
      await refreshAll(accounts[0]);
    } catch (e) {
      show('Connection rejected', 'error');
      console.error(e);
    }
  };

  // Auto-refresh when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && account) {
        fetchAllMembers();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [account, fetchAllMembers]);

  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccountsChanged = (accs) => {
      setAccount(accs[0] || null);
      if (accs[0]) refreshAll(accs[0]);
    };
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
    };
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
    setRegName('');
    setRegEmail('');
    setRegPhone('');
    setRegWallet('');
  };

  const handleContribute = () => {
    const validation = validateRwfAmount(depositRwf, 'deposit');
    if (!validation.valid) {
      show(validation.error, 'error');
      return;
    }
    
    tx(
      async (value) => (await getContract(true)).contribute({ value }),
      `${validation.rwf.toLocaleString()} RWF contributed successfully!`,
      validation.wei
    );
    
    setDepositRwf('');
  };

  const handleWithdraw = () => {
    const validation = validateRwfAmount(withdrawRwf, 'withdraw');
    if (!validation.valid) {
      show(validation.error, 'error');
      return;
    }
    
    tx(
      async () => (await getContract(true)).withdrawSavings(validation.wei),
      `${validation.rwf.toLocaleString()} RWF withdrawn successfully!`
    );
    
    setWithdrawRwf('');
  };

  const handleRequestLoan = () => {
    const validation = validateRwfAmount(loanRwf, 'loan');
    if (!validation.valid) {
      show(validation.error, 'error');
      return;
    }
    
    tx(
      async () => (await getContract(true)).requestLoan(validation.wei),
      `Loan request for ${validation.rwf.toLocaleString()} RWF submitted!`
    );
    
    setLoanRwf('');
  };

  const handleRepay = () => {
    const validation = validateRwfAmount(repayRwf, 'repay');
    if (!validation.valid) {
      show(validation.error, 'error');
      return;
    }
    
    tx(
      async (value) => (await getContract(true)).repayLoan({ value }),
      `${validation.rwf.toLocaleString()} RWF repayment successful!`,
      validation.wei
    );
    
    setRepayRwf('');
  };

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
  
  const handleViewMember = (memberData) => {
    setSelectedMember(memberData);
    setShowMemberModal(true);
  };
  
  const handleRefreshMembers = async () => {
    setRefreshKey(prev => prev + 1);
    await fetchAllMembers();
    show('Member list refreshed!', 'success');
  };

  // ── Derived Values ──────────────────────────────────
  const loanStatusKey = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';
  
  const getSavingsRwf = () => {
    if (!member) return '0';
    return fmtRWFDisplay(member.savings);
  };
  
  const getMaxLoanRwf = () => {
    if (!member) return '0';
    const maxLoanWei = BigInt(member.savings) * 3n;
    const maxLoanRwf = maxLoanWei / WEI_PER_RWF;
    return Number(maxLoanRwf).toLocaleString();
  };
  
  const getPendingDividendsRwf = () => {
    if (!member) return '0';
    return fmtRWFDisplay(member.pendingDividends);
  };
  
  const getTotalPoolRwf = () => {
    if (!totalPool || totalPool === '0') return '0';
    const poolWei = BigInt(Math.floor(parseFloat(totalPool) * Number(WEI_PER_ETH)));
    const poolRwf = poolWei / WEI_PER_RWF;
    return Number(poolRwf).toLocaleString();
  };
  
  const getReservePoolRwf = () => {
    if (!reservePool || reservePool === '0') return '0';
    const reserveWei = BigInt(Math.floor(parseFloat(reservePool) * Number(WEI_PER_ETH)));
    const reserveRwf = reserveWei / WEI_PER_RWF;
    return Number(reserveRwf).toLocaleString();
  };
  
  const getLoanRemainingRwf = () => {
    if (!loan || loanStatusKey !== 'active') return '0';
    const remainingWei = BigInt(loan.remainingOwed);
    const remainingRwf = remainingWei / WEI_PER_RWF;
    return Number(remainingRwf).toLocaleString();
  };
  
  const hasDividends = member && member.pendingDividends && BigInt(member.pendingDividends) > 0n;
  const termPct = term ? termProgress(term.startTime, term.endTime) : 0;
  const minContributionRwf = Math.ceil(0.001 * ETH_RWF_RATE);
  
  // Filter members for search
  const filteredMembers = allMembers.filter(m => 
    m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.email.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.phone.includes(memberSearch) ||
    shortAddr(m.address).toLowerCase().includes(memberSearch.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────
  if (!account) {
    return (
      <div className="dashboard-layout">
        <header className="dashboard-header">
          <div className="header-brand">
            <h1>Ikimina</h1>
            <span>Web3 Savings - RWF</span>
          </div>
        </header>
        <div className="connect-screen">
          <div className="connect-logo">🏦</div>
          <h2>Community Savings Pool</h2>
          <p>Save in RWF, powered by Ethereum. Connect your wallet to join the Ikimina savings group.</p>
          <div className="rate-info">
            💱 Fixed Rate: 1 ETH = {ETH_RWF_RATE.toLocaleString()} RWF
          </div>
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
          <span>Web3 Savings - RWF</span>
        </div>
        <div className="header-actions">
          {isAdmin && <span className="admin-badge">⚙ Admin</span>}
          <span className="network-badge">Sepolia</span>
          <div className="eth-balance">
            <span className="balance-label">ETH Balance:</span>
            <span className="balance-value">{parseFloat(ethBalance).toFixed(4)} ETH</span>
          </div>
          <button className="btn-primary" onClick={connectWallet} disabled={loading}>
            {account ? shortAddr(account) : 'Connect'}
            {loading && <span className="spinner">⟳</span>}
          </button>
        </div>
      </header>

      <div className="dashboard-main">
        {/* Sidebar */}
        <aside className="dashboard-sidebar">
          <nav className="sidebar-nav">
            <SidebarLink href="#profile" active={currentPage === 'profile'} onClick={() => setCurrentPage('profile')}>
              👤 My Profile
            </SidebarLink>
            <SidebarLink href="#members" active={currentPage === 'members'} onClick={() => setCurrentPage('members')}>
              👥 Member Directory
              {allMembers.length > 0 && <span className="nav-badge">{allMembers.length}</span>}
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
              <h1>My Profile</h1>
              {member ? (
                <>
                  <div className="member-profile-card">
                    <div className="profile-avatar">{member.name?.charAt(0).toUpperCase()}</div>
                    <div className="profile-info">
                      <div className="profile-name">{member.name}</div>
                      <div className="profile-meta">
                        <span>✉ {member.email}</span>
                        <span>📞 {member.phone}</span>
                        <span>🆔 {shortAddr(account)}</span>
                      </div>
                      <div className="profile-stats">
                        <span>📅 Joined: {new Date(Number(member.joinedAt) * 1000).toLocaleDateString()}</span>
                        <span>✅ Status: {member.isActive ? 'Active' : 'Inactive'}</span>
                      </div>
                    </div>
                    <div className="profile-wallet">
                      <div className="profile-wallet-label">Wallet Address</div>
                      <div className="profile-wallet-addr">
                        <span className="wallet-full">{account}</span>
                        <button className="copy-btn" onClick={() => {
                          navigator.clipboard.writeText(account);
                          show('Copied!', 'success');
                        }} title="Copy">
                          ⎘
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="exchange-rate-banner">
                    💱 Fixed Exchange Rate: 1 ETH = {ETH_RWF_RATE.toLocaleString()} RWF
                    <span className="rate-note">(No rounding discrepancies - exact values)</span>
                  </div>
                  <div className="stats-grid">
                    <div className="stat-card" style={{ '--accent-color': 'var(--gold)' }}>
                      <div className="stat-label">My Savings</div>
                      <div className="stat-value gold">{getSavingsRwf()} RWF</div>
                      <div className="stat-sub">≈ {member ? fmtETH(member.savings) : '0'} ETH</div>
                      <div className="stat-sub">Max loan: {getMaxLoanRwf()} RWF</div>
                    </div>
                    <div className="stat-card" style={{ '--accent-color': 'var(--green)' }}>
                      <div className="stat-label">Total Pool</div>
                      <div className="stat-value green">{getTotalPoolRwf()} RWF</div>
                      <div className="stat-sub">≈ {totalPool} ETH</div>
                      <div className="stat-sub">Reserve: {getReservePoolRwf()} RWF</div>
                    </div>
                    <div className="stat-card" style={{ '--accent-color': 'var(--blue)' }}>
                      <div className="stat-label">Loan Status</div>
                      <div style={{ marginTop: '0.4rem' }}>
                        <span className={`loan-status ${loanStatusKey}`}>
                          {loan && LOAN_STATUS[Number(loan.status)] ? LOAN_STATUS[Number(loan.status)] : 'None'}
                        </span>
                      </div>
                      {loanStatusKey === 'active' && (
                        <div className="stat-sub">Due: {new Date(Number(loan.deadline) * 1000).toLocaleDateString()}</div>
                      )}
                    </div>
                    <div className="stat-card" style={{ '--accent-color': 'var(--amber)' }}>
                      <div className="stat-label">Pending Dividends</div>
                      <div className="stat-value amber">{getPendingDividendsRwf()} RWF</div>
                      <div className="stat-sub">≈ {member ? fmtETH(member.pendingDividends) : '0'} ETH</div>
                      <div className="stat-sub">Members: {memberCount}</div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <p>You are not registered as a member yet.</p>
                  <p>Please contact the admin to register you.</p>
                </div>
              )}
            </div>
          )}

          {/* Member Directory Page */}
          {currentPage === 'members' && (
            <div className="page-section">
              <div className="member-directory-header">
                <h1>Member Directory</h1>
                <button 
                  className="btn-refresh" 
                  onClick={handleRefreshMembers}
                  disabled={loadingMembers}
                >
                  {loadingMembers ? '⟳ Loading...' : '🔄 Refresh'}
                </button>
              </div>
              
              <div className="member-directory-controls">
                <div className="search-bar">
                  <input 
                    type="text" 
                    placeholder="Search by name, email, phone, or address..." 
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                  />
                </div>
                <div className="directory-stats">
                  Total Members: {allMembers.length} | Active: {allMembers.filter(m => m.isActive).length}
                </div>
              </div>
              
              {loadingMembers ? (
                <div className="loading-state">
                  <div className="spinner-large"></div>
                  <p>Loading members from blockchain...</p>
                </div>
              ) : allMembers.length === 0 ? (
                <div className="empty-state">
                  <p>No members found in directory.</p>
                  {isAdmin ? (
                    <>
                      <p>Use the Admin panel below to register members.</p>
                      <button 
                        className="btn-primary" 
                        onClick={() => setCurrentPage('admin')}
                        style={{ marginTop: '1rem', width: 'auto' }}
                      >
                        Go to Admin Panel
                      </button>
                    </>
                  ) : (
                    <p>Ask the admin to register members.</p>
                  )}
                </div>
              ) : (
                <div className="members-grid">
                  {filteredMembers.map((m, idx) => (
                    <div key={idx} className="member-card" onClick={() => handleViewMember(m)}>
                      <div className="member-avatar">{m.name.charAt(0).toUpperCase()}</div>
                      <div className="member-info">
                        <div className="member-name">{m.name}</div>
                        <div className="member-details">
                          <span>📧 {m.email}</span>
                          <span>📞 {m.phone}</span>
                        </div>
                        <div className="member-address">{shortAddr(m.address)}</div>
                        <div className="member-stats">
                          <span>💰 {fmtRWFDisplay(m.savings)} RWF</span>
                          {m.hasActiveLoan && <span className="loan-badge">Active Loan</span>}
                          {!m.isActive && <span className="inactive-badge">Inactive</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Member Detail Modal */}
          {showMemberModal && selectedMember && (
            <div className="modal-overlay" onClick={() => setShowMemberModal(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Member Details</h2>
                  <button className="modal-close" onClick={() => setShowMemberModal(false)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="member-detail-header">
                    <div className="detail-avatar">{selectedMember.name.charAt(0).toUpperCase()}</div>
                    <div className="detail-info">
                      <h3>{selectedMember.name}</h3>
                      <p>📧 {selectedMember.email}</p>
                      <p>📞 {selectedMember.phone}</p>
                    </div>
                  </div>
                  
                  <div className="detail-section">
                    <h4>Wallet Information</h4>
                    <div className="detail-row">
                      <span>Address:</span>
                      <code>{selectedMember.address}</code>
                      <button className="copy-btn-small" onClick={() => {
                        navigator.clipboard.writeText(selectedMember.address);
                        show('Copied!', 'success');
                      }}>Copy</button>
                    </div>
                  </div>
                  
                  <div className="detail-section">
                    <h4>Financial Summary</h4>
                    <div className="stats-mini-grid">
                      <div className="stat-mini">
                        <label>Savings</label>
                        <value>{fmtRWFDisplay(selectedMember.savings)} RWF</value>
                      </div>
                      <div className="stat-mini">
                        <label>Pending Dividends</label>
                        <value>{fmtRWFDisplay(selectedMember.pendingDividends)} RWF</value>
                      </div>
                      <div className="stat-mini">
                        <label>Status</label>
                        <value className={selectedMember.isActive ? 'active' : 'inactive'}>
                          {selectedMember.isActive ? 'Active' : 'Inactive'}
                        </value>
                      </div>
                      <div className="stat-mini">
                        <label>Joined</label>
                        <value>{new Date(Number(selectedMember.joinedAt) * 1000).toLocaleDateString()}</value>
                      </div>
                    </div>
                  </div>
                  
                  {selectedMember.hasActiveLoan && (
                    <div className="detail-section">
                      <h4>Loan Information</h4>
                      <div className="detail-row">
                        <span>Loan Amount:</span>
                        <strong>{fmtRWFDisplay(selectedMember.loanAmount)} RWF</strong>
                      </div>
                      <div className="detail-row">
                        <span>Total Owed:</span>
                        <strong>{fmtRWFDisplay(selectedMember.loanTotalOwed)} RWF</strong>
                      </div>
                      <div className="detail-row">
                        <span>Repaid:</span>
                        <strong>{fmtRWFDisplay(selectedMember.loanAmountRepaid)} RWF</strong>
                      </div>
                      <div className="detail-row">
                        <span>Status:</span>
                        <span className={`loan-status ${selectedMember.loanStatus === 2 ? 'active' : 'pending'}`}>
                          {selectedMember.loanStatus === 2 ? 'Active' : 'Pending'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Savings Page */}
          {currentPage === 'savings' && (
            <div className="page-section">
              <h1>Savings</h1>
              {term && (
                <div className="action-card" style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '0.95rem' }}>Term #{term.termId?.toString() || '0'}</span>
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
                      <div className="term-bar-fill" style={{ width: `${termPct}%` }} />
                    </div>
                  </div>
                </div>
              )}
              <div className="actions-section">
                <div className="action-card">
                  <h2>Add Savings</h2>
                  <p className="card-desc">Contribute to the pool. Minimum {minContributionRwf.toLocaleString()} RWF.</p>
                  <div className="input-group">
                    <label>Amount (RWF)</label>
                    <input 
                      type="number" 
                      value={depositRwf} 
                      onChange={(e) => setDepositRwf(e.target.value)} 
                      placeholder={`e.g., ${minContributionRwf}`} 
                      min={minContributionRwf} 
                      step="1000" 
                    />
                  </div>
                  {depositRwf && parseFloat(depositRwf) > 0 && (
                    <div className="eth-equivalent">
                      ≈ {rwfToEthString(depositRwf)} ETH
                    </div>
                  )}
                  <button className="btn-full" onClick={handleContribute} disabled={loading || !depositRwf}>
                    {loading ? <span className="spinner">⟳</span> : `Deposit ${depositRwf ? parseFloat(depositRwf).toLocaleString() : ''} RWF`}
                  </button>
                </div>
                <div className="action-card">
                  <h2>Withdraw Savings</h2>
                  <p className="card-desc">Withdraw your savings. No active loan required.</p>
                  <div className="input-group">
                    <label>Amount (RWF)</label>
                    <input 
                      type="number" 
                      value={withdrawRwf} 
                      onChange={(e) => setWithdrawRwf(e.target.value)} 
                      placeholder="e.g., 25000" 
                      min="1000" 
                      step="1000" 
                    />
                  </div>
                  {withdrawRwf && parseFloat(withdrawRwf) > 0 && (
                    <div className="eth-equivalent">
                      ≈ {rwfToEthString(withdrawRwf)} ETH
                    </div>
                  )}
                  <div className="available-balance">
                    Available: {getSavingsRwf()} RWF
                  </div>
                  <button className="btn-danger" onClick={handleWithdraw} disabled={loading || !withdrawRwf || loanStatusKey === 'active'}>
                    {loanStatusKey === 'active' ? 'Repay loan first' : loading ? <span className="spinner">⟳</span> : 'Withdraw'}
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
                      <div className="loan-info-row"><span>Principal</span><span>{loan ? fmtRWFDisplay(loan.principal) : '0'} RWF</span></div>
                      <div className="loan-info-row"><span>Total Owed</span><span>{loan ? fmtRWFDisplay(loan.totalOwed) : '0'} RWF</span></div>
                      <div className="loan-info-row"><span>Repaid</span><span>{loan ? fmtRWFDisplay(loan.amountRepaid) : '0'} RWF</span></div>
                      <div className="loan-info-row"><span>Remaining</span><span style={{ color: 'var(--red)' }}>{getLoanRemainingRwf()} RWF</span></div>
                      {loanStatusKey === 'active' && (
                        <div className="loan-info-row"><span>Deadline</span><span>{new Date(Number(loan.deadline) * 1000).toLocaleDateString()}</span></div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="input-group">
                        <label>Loan Amount (RWF)</label>
                        <input 
                          type="number" 
                          value={loanRwf} 
                          onChange={(e) => setLoanRwf(e.target.value)} 
                          placeholder="e.g., 100000" 
                          min="10000" 
                          step="10000" 
                        />
                      </div>
                      {loanRwf && parseFloat(loanRwf) > 0 && (
                        <div className="eth-equivalent">
                          ≈ {rwfToEthString(loanRwf)} ETH
                        </div>
                      )}
                      <div className="loan-limits">
                        Max: {getMaxLoanRwf()} RWF · 5% interest · 30 days
                      </div>
                      <button className="btn-full" onClick={handleRequestLoan} disabled={loading || !loanRwf}>
                        {loading ? <span className="spinner">⟳</span> : `Request ${loanRwf ? parseFloat(loanRwf).toLocaleString() : ''} RWF`}
                      </button>
                    </>
                  )}
                </div>
                <div className="action-card">
                  <h2>Repay Loan</h2>
                  <p className="card-desc">Partial or full repayment. Overpayment refunded. Any amount accepted.</p>
                  <div className="input-group">
                    <label>Repayment Amount (RWF)</label>
                    <input 
                      type="number" 
                      value={repayRwf} 
                      onChange={(e) => setRepayRwf(e.target.value)} 
                      placeholder="Enter any amount" 
                      min="1" 
                      step="1000" 
                      disabled={loanStatusKey !== 'active'} 
                    />
                  </div>
                  {repayRwf && parseFloat(repayRwf) > 0 && loanStatusKey === 'active' && (
                    <div className="eth-equivalent">
                      ≈ {rwfToEthString(repayRwf)} ETH
                    </div>
                  )}
                  {loanStatusKey === 'active' && (
                    <div className="remaining-balance">
                      Remaining: {getLoanRemainingRwf()} RWF
                    </div>
                  )}
                  <button className="btn-green" onClick={handleRepay} disabled={loading || loanStatusKey !== 'active' || !repayRwf}>
                    {loanStatusKey !== 'active' ? 'No Active Loan' : loading ? <span className="spinner">⟳</span> : `Repay ${repayRwf ? parseFloat(repayRwf).toLocaleString() : ''} RWF`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Dividends Page */}
          {currentPage === 'dividends' && member && (
            <div className="page-section">
              <h1>Dividends</h1>
              <div className="actions-section">
                <div className="action-card">
                  <h2>Your Dividends</h2>
                  <p className="card-desc">80% of term interest distributed pro-rata.</p>
                  <div className="loan-info">
                    <div className="loan-info-row"><span>Pending</span><span style={{ color: 'var(--amber)' }}>{getPendingDividendsRwf()} RWF</span></div>
                    <div className="loan-info-row"><span>Savings</span><span>{getSavingsRwf()} RWF</span></div>
                    <div className="loan-info-row"><span>Term Interest</span><span>{term ? fmtRWFDisplay(term.interestCollected) : '—'} RWF</span></div>
                  </div>
                  <button className="btn-full" onClick={handleClaimDividends} disabled={loading || !hasDividends}>
                    {!hasDividends ? 'No Dividends' : loading ? <span className="spinner">⟳</span> : 'Claim Dividends'}
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
                    {term?.distributed ? 'Done' : termPct < 100 ? `Term ${termPct}%` : loading ? <span className="spinner">⟳</span> : 'Distribute'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Admin Page */}
          {currentPage === 'admin' && isAdmin && (
            <div className="page-section">
              <h1>Admin Panel</h1>
              <div className="action-card">
                <h2>Register New Member</h2>
                <div className="register-form">
                  <div className="input-group">
                    <label>Wallet Address</label>
                    <input value={regWallet} onChange={(e) => setRegWallet(e.target.value)} placeholder="0x123..." />
                  </div>
                  <div className="input-group">
                    <label>Full Name</label>
                    <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="John Doe" />
                  </div>
                  <div className="input-group">
                    <label>Email Address</label>
                    <input value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="john@example.com" />
                  </div>
                  <div className="input-group">
                    <label>Phone Number</label>
                    <input value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="+250 788 123 456" />
                  </div>
                </div>
                <button className="btn-full" onClick={handleRegister} disabled={loading || !regWallet || !regName || !regEmail || !regPhone}>
                  {loading ? <span className="spinner">⟳</span> : 'Register Member'}
                </button>
              </div>
              
              <div className="pending-requests">
                <h2>Pending Loan Requests ({pendingReqs.length})</h2>
                {pendingReqs.length === 0 ? (
                  <div className="empty-state">No pending requests</div>
                ) : (
                  pendingReqs.map(r => {
                    const memberInfo = allMembers.find(m => m.address.toLowerCase() === r.borrower?.toLowerCase());
                    return (
                      <div key={r.id} className="request-card">
                        <div className="request-info">
                          <div className="request-borrower">
                            <strong>{memberInfo?.name || shortAddr(r.borrower)}</strong>
                            <small>{shortAddr(r.borrower)}</small>
                          </div>
                          <div className="request-amount">{fmtRWFDisplay(r.amount)} RWF</div>
                          <div className="request-date">{new Date(Number(r.requestedAt) * 1000).toLocaleString()}</div>
                        </div>
                        <div className="request-actions">
                          <button className="btn-approve" onClick={() => handleApproveLoan(r.id)}>✓ Approve</button>
                          <button className="btn-reject" onClick={() => handleRejectLoan(r.id)}>✕ Reject</button>
                        </div>
                      </div>
                    );
                  })
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
          <span>💱 1 ETH = {ETH_RWF_RATE.toLocaleString()} RWF (Fixed)</span>
          <span>👥 {memberCount} Members</span>
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