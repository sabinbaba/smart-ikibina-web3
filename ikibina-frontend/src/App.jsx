import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESS, ABI, LOAN_STATUS, MEMBER_ROLES, POOL_SAFETY } from './contracts/config';
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

// ── Utilities ──────────────────────────────────────────
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

// ── Helper: check if a role is a leader role ──────────
const isLeaderRole = (role) => role === 1 || role === 2 || role === 3;

// ── Main App ──────────────────────────────────────────
export default function App() {
  const { toasts, show } = useToast();

  // Wallet
  const [account, setAccount] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ethBalance, setEthBalance] = useState('0');
  const [userRole, setUserRole] = useState(null);
  const [isAuthorizedApprover, setIsAuthorizedApprover] = useState(false);

  // Contract data
  const [member, setMember] = useState(null);
  const [loan, setLoan] = useState(null);
  const [term, setTerm] = useState(null);
  const [totalPool, setTotalPool] = useState('0');
  const [reservePool, setReservePool] = useState('0');
  const [memberCount, setMemberCount] = useState('0');
  const [contractBal, setContractBal] = useState('0');
  const [pendingReqs, setPendingReqs] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);

  // Member directory
  const [allMembers, setAllMembers] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Navigation
  const [currentPage, setCurrentPage] = useState('profile');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regWallet, setRegWallet] = useState('');
  const [regRole, setRegRole] = useState(0);

  // RWF amounts
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

  // ── Fetch pending approvals ───────────────────────────
  // Uses resolved values (not stale state) to decide whether to fetch.
  // NOTE: The ABI has no loanApprovals(id, addr) mapping view, so we
  // cannot check per-leader approval status; all unapproved requests shown.
  const fetchPendingApprovalsWithValues = useCallback(async (walletAddr, adminMatch, resolvedRole) => {
    if (adminMatch || !isLeaderRole(resolvedRole)) return;
    try {
      const c = await getContract();
      const reqCount = Number(await c.loanRequestCount());
      const approvals = [];
      for (let i = reqCount - 1; i >= Math.max(0, reqCount - 20); i--) {
        try {
          const r = await c.getLoanRequest(i);
          if (r && !r.approved && !r.rejected) {
            approvals.push({
              id: i,
              borrower: r.borrower,
              amount: r.amount,
              requestedAt: r.requestedAt,
            });
          }
        } catch (_) {}
      }
      setPendingApprovals(approvals);
      if (approvals.length > 0) {
        show(`🔔 You have ${approvals.length} pending loan request${approvals.length > 1 ? 's' : ''} to review!`, 'info');
      }
    } catch (err) {
      console.error('Error fetching approvals:', err);
    }
  }, [show]);

  const fetchPendingApprovals = useCallback(async () => {
    if (!account) return;
    await fetchPendingApprovalsWithValues(account, isAdmin, userRole);
  }, [account, isAdmin, userRole, fetchPendingApprovalsWithValues]);

  // ── Dividend Projections ──────────────────────────────
  const calculateDividendProjections = () => {
    if (!term || !allMembers.length) return [];
    const totalInterestWei = BigInt(term.interestCollected || 0);
    const dividendPoolWei = (totalInterestWei * 8000n) / 10000n;
    const totalSavingsWei = allMembers.reduce((total, m) => total + (m.isActive ? BigInt(m.savings) : 0n), 0n);

    const projections = allMembers.map(m => {
      const savingsWei = BigInt(m.savings);
      const savingsRwf = Number(savingsWei / WEI_PER_RWF);
      let projectedDividendWei = 0n;
      let percentage = 0;
      if (totalSavingsWei > 0n && m.isActive) {
        projectedDividendWei = (dividendPoolWei * savingsWei) / totalSavingsWei;
        percentage = Number((savingsWei * 10000n) / totalSavingsWei) / 100;
      }
      return {
        address: m.address,
        name: m.name,
        role: m.role,
        roleName: MEMBER_ROLES[m.role] || 'Regular',
        savingsRwf,
        percentage,
        projectedDividend: Number(projectedDividendWei / WEI_PER_RWF),
        isActive: m.isActive,
      };
    });
    return projections.sort((a, b) => b.projectedDividend - a.projectedDividend);
  };

  const calculateTotalSavings = () =>
    allMembers.reduce((total, m) => total + Number(BigInt(m.savings) / WEI_PER_RWF), 0);

  const calculateTotalDividendPool = () => {
    if (!term) return 0;
    const totalInterestWei = BigInt(term.interestCollected || 0);
    return Number((totalInterestWei * 8000n) / 10000n / WEI_PER_RWF);
  };

  // ── Fetch all members ─────────────────────────────────
  const fetchAllMembers = useCallback(async () => {
    if (!account || !window.ethereum) return;
    setLoadingMembers(true);
    try {
      const c = await getContract();
      const memberAddresses = await c.getMemberList();
      if (!memberAddresses || memberAddresses.length === 0) {
        setAllMembers([]);
        return;
      }
      const membersData = [];
      for (const addr of memberAddresses) {
        try {
          const m = await c.getMember(addr);
          if (m && m.isRegistered) {
            let loanData = { status: 0, principal: 0, totalOwed: 0, amountRepaid: 0 };
            try { loanData = await c.getLoan(addr); } catch (_) {}
            membersData.push({
              address: addr,
              name: m.name,
              email: m.email,
              phone: m.phone,
              isActive: m.isActive,
              savings: m.savings,
              pendingDividends: m.pendingDividends,
              joinedAt: m.joinedAt,
              role: Number(m.role) || 0,
              hasActiveLoan: Number(loanData.status) === 1 || Number(loanData.status) === 2,
              loanAmount: loanData.principal,
              loanStatus: Number(loanData.status),
              loanTotalOwed: loanData.totalOwed,
              loanAmountRepaid: loanData.amountRepaid,
            });
          }
        } catch (err) {
          console.error(`Error fetching member ${addr}:`, err);
        }
      }
      setAllMembers(membersData);
    } catch (err) {
      console.error('Error fetching members:', err);
      setAllMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, [account]);

  // ── Validate RWF amounts ──────────────────────────────
  const validateRwfAmount = (amount, type = 'deposit') => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return { valid: false, error: 'Please enter a valid amount in RWF' };
    const weiAmount = rwfToWei(amount);
    const ethAmount = Number(weiAmount) / Number(WEI_PER_ETH);
    const minEth = 0.001;
    const minRwf = Math.ceil(minEth * ETH_RWF_RATE);

    if (type === 'deposit') {
      if (ethAmount < minEth - 0.0000001) return { valid: false, error: `Minimum contribution is ${minRwf.toLocaleString()} RWF` };
      return { valid: true, rwf: numAmount, wei: weiAmount, eth: ethAmount };
    }
    if (type === 'repay') {
      const lsk = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';
      if (lsk !== 'active') return { valid: false, error: 'No active loan to repay' };
      if (loan && lsk === 'active') {
        const remainingRwf = Number(BigInt(loan.remainingOwed) / WEI_PER_RWF);
        if (numAmount > remainingRwf) return { valid: false, error: `Amount exceeds remaining loan of ${remainingRwf.toLocaleString()} RWF` };
      }
      return { valid: true, rwf: numAmount, wei: weiAmount, eth: ethAmount };
    }
    if (type === 'withdraw') {
      if (!member) return { valid: false, error: 'Not a registered member' };
      if (weiAmount > BigInt(member.savings)) return { valid: false, error: 'Insufficient savings balance' };
      const lsk = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';
      if (lsk === 'active') return { valid: false, error: 'Repay active loan first before withdrawing' };
      return { valid: true, rwf: numAmount, wei: weiAmount, eth: ethAmount };
    }
    if (type === 'loan') {
      if (!member) return { valid: false, error: 'Not a registered member' };
      const maxLoanWei = BigInt(member.savings) * 3n;
      if (weiAmount > maxLoanWei) return { valid: false, error: `Maximum loan is ${Number(maxLoanWei / WEI_PER_RWF).toLocaleString()} RWF` };
      const lsk = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';
      if (lsk === 'active' || lsk === 'pending') return { valid: false, error: 'You already have an active or pending loan' };
      return { valid: true, rwf: numAmount, wei: weiAmount, eth: ethAmount };
    }
    return { valid: false, error: 'Invalid transaction type' };
  };

  const tx = async (fn, successMsg, valueWei = null) => {
    setLoading(true);
    try {
      const t = await (valueWei !== null ? fn(valueWei) : fn());
      show('Transaction sent — waiting…', 'info');
      await t.wait();
      show(successMsg, 'success');
      await refreshAll(account);
    } catch (e) {
      const reason = e.reason || e.error?.message || e.message?.match(/execution reverted: (.+?)"/)?.[1] || e.message?.slice(0, 160) || 'Transaction failed';
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

      // ── Resolve from fresh data — NOT stale state ──
      const adminMatch = adminAddr && adminAddr.toLowerCase() === wallet.toLowerCase();
      setIsAdmin(adminMatch);
      setTotalPool(fmtETH(pool));
      setReservePool(fmtETH(reserve));
      setMemberCount(Number(mCount).toString());
      setContractBal(fmtETH(bal));
      setTerm(termData);

      const m = await c.getMember(wallet);
      const registered = m && m.isRegistered && m.isActive;
      setMember(registered ? m : null);

      // ── Number() cast: ethers may return BigInt for uint8 ──
      let resolvedRole = null;
      if (registered && m.role !== undefined) {
        resolvedRole = Number(m.role);
        setUserRole(resolvedRole);
        setIsAuthorizedApprover(isLeaderRole(resolvedRole));
      } else {
        setUserRole(null);
        setIsAuthorizedApprover(false);
      }

      if (registered) {
        try { setLoan(await c.getLoan(wallet)); } catch (_) { setLoan(null); }
      } else {
        setLoan(null);
      }

      // Pending requests list (for admin view)
      const reqCount = Number(await c.loanRequestCount());
      if (reqCount > 0) {
        const reqs = [];
        for (let i = reqCount - 1; i >= Math.max(0, reqCount - 20); i--) {
          try {
            const r = await c.getLoanRequest(i);
            if (r && !r.approved && !r.rejected) reqs.push({ id: i, ...r });
          } catch (_) {}
        }
        setPendingReqs(reqs);
      }

      await fetchAllMembers();

      // ── CRITICAL: pass freshly-resolved values, never read stale state ──
      await fetchPendingApprovalsWithValues(wallet, adminMatch, resolvedRole);

    } catch (e) {
      console.error('refreshAll error:', e);
    }
  }, [account, fetchAllMembers, fetchPendingApprovalsWithValues]);

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
    const handleVisibilityChange = () => {
      if (!document.hidden && account) {
        fetchAllMembers();
        if (!isAdmin && isLeaderRole(userRole)) fetchPendingApprovals();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [account, isAdmin, userRole, fetchAllMembers, fetchPendingApprovals]);

  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccountsChanged = (accs) => {
      setAccount(accs[0] || null);
      if (accs[0]) refreshAll(accs[0]);
    };
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    return () => window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
  }, [refreshAll]);

  // ── Transactions ──────────────────────────────────────
  const handleRegister = () => {
    if (!isAdmin) { show('Only admin can register members', 'error'); return; }
    tx(
      async () => (await getContract(true)).register(regName, regEmail, regPhone, regWallet, regRole),
      `Registered ${shortAddr(regWallet)} as ${MEMBER_ROLES[regRole]} successfully!`
    );
    setRegName(''); setRegEmail(''); setRegPhone(''); setRegWallet(''); setRegRole(0);
  };

  const handleContribute = () => {
    const v = validateRwfAmount(depositRwf, 'deposit');
    if (!v.valid) { show(v.error, 'error'); return; }
    tx(async (value) => (await getContract(true)).contribute({ value }), `${v.rwf.toLocaleString()} RWF contributed!`, v.wei);
    setDepositRwf('');
  };

  const handleWithdraw = () => {
    const v = validateRwfAmount(withdrawRwf, 'withdraw');
    if (!v.valid) { show(v.error, 'error'); return; }
    tx(async () => (await getContract(true)).withdrawSavings(v.wei), `${v.rwf.toLocaleString()} RWF withdrawn!`);
    setWithdrawRwf('');
  };

  const handleRequestLoan = () => {
    const v = validateRwfAmount(loanRwf, 'loan');
    if (!v.valid) { show(v.error, 'error'); return; }
    tx(async () => (await getContract(true)).requestLoan(v.wei), `Loan request for ${v.rwf.toLocaleString()} RWF submitted!`);
    setLoanRwf('');
  };

  const handleRepay = () => {
    const v = validateRwfAmount(repayRwf, 'repay');
    if (!v.valid) { show(v.error, 'error'); return; }
    tx(async (value) => (await getContract(true)).repayLoan({ value }), `${v.rwf.toLocaleString()} RWF repayment successful!`, v.wei);
    setRepayRwf('');
  };

  const handleClaimDividends = () => tx(
    async () => (await getContract(true)).claimDividends(), 'Dividends claimed!'
  );

  const handleDistributeDividends = () => tx(
    async () => (await getContract(true)).distributeDividends(), 'Dividends distributed!'
  );

  // ── Approve loan ──────────────────────────────────────
  // ✅ Correct ABI function name: approveLoan(uint256 _requestId)
  const handleApproveLoan = async (requestId) => {
    if (isAdmin || !isLeaderRole(userRole)) {
      show('Only leaders (President, Accountant, Chief of Member) can approve loans', 'error');
      return;
    }
    setLoading(true);
    try {
      const contract = await getContract(true);
      const t = await contract.approveLoan(requestId);
      show(`✓ Approving loan #${requestId}… waiting for confirmation`, 'info');
      await t.wait();
      show(`✅ Loan #${requestId} approved! Disbursed when 2 leaders approve.`, 'success');
      await refreshAll(account);
    } catch (e) {
      const reason = e.reason || e.message?.slice(0, 160) || 'Transaction failed';
      show(reason, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRejectLoan = (id) => tx(
    async () => (await getContract(true)).rejectLoan(id), `Loan #${id} rejected.`
  );

  const handleViewMember = (memberData) => { setSelectedMember(memberData); setShowMemberModal(true); };
  const handleRefreshMembers = async () => { await fetchAllMembers(); show('Member list refreshed!', 'success'); };

  // ── Derived Values ──────────────────────────────────
  const loanStatusKey = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';

  const getSavingsRwf    = () => member ? fmtRWFDisplay(member.savings) : '0';
  const getMaxLoanRwf    = () => member ? Number(BigInt(member.savings) * 3n / WEI_PER_RWF).toLocaleString() : '0';
  const getPendingDivRwf = () => member ? fmtRWFDisplay(member.pendingDividends) : '0';

  const getTotalPoolRwf = () => {
    if (!totalPool || totalPool === '0') return '0';
    return Number(BigInt(Math.floor(parseFloat(totalPool) * Number(WEI_PER_ETH))) / WEI_PER_RWF).toLocaleString();
  };
  const getReservePoolRwf = () => {
    if (!reservePool || reservePool === '0') return '0';
    return Number(BigInt(Math.floor(parseFloat(reservePool) * Number(WEI_PER_ETH))) / WEI_PER_RWF).toLocaleString();
  };
  const getLoanRemainingRwf = () => {
    if (!loan || loanStatusKey !== 'active') return '0';
    return Number(BigInt(loan.remainingOwed) / WEI_PER_RWF).toLocaleString();
  };

  const hasDividends = member && member.pendingDividends && BigInt(member.pendingDividends) > 0n;
  const termPct = term ? termProgress(term.startTime, term.endTime) : 0;
  const minContributionRwf = Math.ceil(0.001 * ETH_RWF_RATE);

  const filteredMembers = allMembers.filter(m =>
    m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.email.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.phone.includes(memberSearch) ||
    shortAddr(m.address).toLowerCase().includes(memberSearch.toLowerCase())
  );

  const dividendProjections = calculateDividendProjections();
  const totalSavings        = calculateTotalSavings();
  const totalDividendPool   = calculateTotalDividendPool();

  const getUserRoleName = () => {
    if (isAdmin) return 'Admin';
    if (userRole !== undefined && userRole !== null) return MEMBER_ROLES[userRole] || 'Member';
    return 'Member';
  };

  // ── Sidebar visibility — direct check on settled state ──
  const showApprovalsLink = !isAdmin && isLeaderRole(userRole);

  // ── Render ────────────────────────────────────────────
  if (!account) {
    return (
      <div className="dashboard-layout">
        <header className="dashboard-header">
          <div className="header-brand"><h1>Ikimina</h1><span>Web3 Savings - RWF</span></div>
        </header>
        <div className="connect-screen">
          <div className="connect-logo">🏦</div>
          <h2>Community Savings Pool</h2>
          <p>Save in RWF, powered by Ethereum. Connect your wallet to join the Ikimina savings group.</p>
          <div className="rate-info">💱 Fixed Rate: 1 ETH = {ETH_RWF_RATE.toLocaleString()} RWF</div>
          <button className="connect-btn-large" onClick={connectWallet}>Connect Wallet</button>
        </div>
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  return (
    <div className="dashboard-layout">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-brand"><h1>Ikimina</h1><span>Web3 Savings - RWF</span></div>
        <div className="header-actions">
          {isAdmin && <span className="admin-badge">⚙ Admin</span>}
          {!isAdmin && userRole !== null && userRole > 0 && <span className="role-badge">{getUserRoleName()}</span>}
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

            {/* ✅ Loan Approvals — Leaders ONLY (role 1,2,3), NOT admin */}
            {showApprovalsLink && (
              <SidebarLink href="#approvals" active={currentPage === 'approvals'} onClick={() => setCurrentPage('approvals')}>
                ✓ Loan Approvals
                {pendingApprovals.length > 0 && <span className="nav-badge">{pendingApprovals.length}</span>}
              </SidebarLink>
            )}

            {/* ⚙ Admin — deployer only */}
            {isAdmin && (
              <SidebarLink href="#admin" active={currentPage === 'admin'} onClick={() => setCurrentPage('admin')}>
                ⚙ Admin
              </SidebarLink>
            )}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="dashboard-content">

          {/* ── Profile Page ── */}
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
                        <span>👔 Role: {getUserRoleName()}</span>
                      </div>
                    </div>
                    <div className="profile-wallet">
                      <div className="profile-wallet-label">Wallet Address</div>
                      <div className="profile-wallet-addr">
                        <span className="wallet-full">{account}</span>
                        <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(account); show('Copied!', 'success'); }} title="Copy">⎘</button>
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
                      <div className="stat-value amber">{getPendingDivRwf()} RWF</div>
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

          {/* ── Member Directory ── */}
          {currentPage === 'members' && (
            <div className="page-section">
              <div className="member-directory-header">
                <h1>Member Directory</h1>
                <button className="btn-refresh" onClick={handleRefreshMembers} disabled={loadingMembers}>
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
                      <p>Use the Admin panel to register members.</p>
                      <button className="btn-primary" onClick={() => setCurrentPage('admin')} style={{ marginTop: '1rem', width: 'auto' }}>
                        Go to Admin Panel
                      </button>
                    </>
                  ) : <p>Ask the admin to register members.</p>}
                </div>
              ) : (
                <div className="members-grid">
                  {filteredMembers.map((m, idx) => (
                    <div key={idx} className="member-card" onClick={() => handleViewMember(m)}>
                      <div className="member-avatar">{m.name.charAt(0).toUpperCase()}</div>
                      <div className="member-info">
                        <div className="member-name">
                          {m.name}
                          {m.role > 0 && <span className="role-tag">{MEMBER_ROLES[m.role]}</span>}
                        </div>
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

          {/* ── Member Detail Modal ── */}
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
                      <p>👔 Role: <strong>{MEMBER_ROLES[selectedMember.role] || 'Regular Member'}</strong></p>
                    </div>
                  </div>
                  <div className="detail-section">
                    <h4>Wallet Information</h4>
                    <div className="detail-row">
                      <span>Address:</span>
                      <code>{selectedMember.address}</code>
                      <button className="copy-btn-small" onClick={() => { navigator.clipboard.writeText(selectedMember.address); show('Copied!', 'success'); }}>Copy</button>
                    </div>
                  </div>
                  <div className="detail-section">
                    <h4>Financial Summary</h4>
                    <div className="stats-mini-grid">
                      <div className="stat-mini"><label>Savings</label><value>{fmtRWFDisplay(selectedMember.savings)} RWF</value></div>
                      <div className="stat-mini"><label>Pending Dividends</label><value>{fmtRWFDisplay(selectedMember.pendingDividends)} RWF</value></div>
                      <div className="stat-mini">
                        <label>Status</label>
                        <value className={selectedMember.isActive ? 'active' : 'inactive'}>{selectedMember.isActive ? 'Active' : 'Inactive'}</value>
                      </div>
                      <div className="stat-mini"><label>Joined</label><value>{new Date(Number(selectedMember.joinedAt) * 1000).toLocaleDateString()}</value></div>
                    </div>
                  </div>
                  {selectedMember.hasActiveLoan && (
                    <div className="detail-section">
                      <h4>Loan Information</h4>
                      <div className="detail-row"><span>Loan Amount:</span><strong>{fmtRWFDisplay(selectedMember.loanAmount)} RWF</strong></div>
                      <div className="detail-row"><span>Total Owed:</span><strong>{fmtRWFDisplay(selectedMember.loanTotalOwed)} RWF</strong></div>
                      <div className="detail-row"><span>Repaid:</span><strong>{fmtRWFDisplay(selectedMember.loanAmountRepaid)} RWF</strong></div>
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

          {/* ── Loan Approvals Page — Leaders ONLY ── */}
          {currentPage === 'approvals' && showApprovalsLink && (
            <div className="page-section">
              <h1>Loan Approvals</h1>
              <div className="approvals-info">
                <div className="leader-info">
                  <span className="role-badge">{getUserRoleName()}</span>
                  <p>
                    As <strong>{getUserRoleName()}</strong>, you can approve loan requests.
                    Each loan requires <strong>2 leader approvals</strong> before disbursement.
                  </p>
                </div>
              </div>
              <div className="pending-requests">
                <h2>Pending Loan Requests ({pendingApprovals.length})</h2>
                {pendingApprovals.length === 0 ? (
                  <div className="empty-state">
                    <p>✅ No pending loan requests. You're all caught up!</p>
                  </div>
                ) : (
                  pendingApprovals.map(r => {
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
                          <button
                            className="btn-approve"
                            onClick={() => handleApproveLoan(r.id)}
                            disabled={loading}
                          >
                            {loading ? '⟳ Processing...' : `✓ Approve as ${getUserRoleName()}`}
                          </button>
                          <button
                            className="btn-danger"
                            onClick={() => handleRejectLoan(r.id)}
                            disabled={loading}
                            style={{ marginTop: '0.5rem' }}
                          >
                            ✕ Reject
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="info-card">
                <h3>📋 How Loan Approvals Work</h3>
                <ul>
                  <li><strong>Step 1:</strong> Member requests a loan</li>
                  <li><strong>Step 2:</strong> Leaders (President, Accountant, Chief) review it</li>
                  <li><strong>Step 3:</strong> Each leader clicks Approve</li>
                  <li><strong>Step 4:</strong> When <strong>2 leaders approve</strong>, the loan is automatically disbursed</li>
                  <li><strong>Step 5:</strong> Member receives funds in their wallet</li>
                </ul>
                <p className="info-note">💡 Multi-sig ensures community oversight and prevents single-point approval.</p>
              </div>
            </div>
          )}

          {/* ── Savings Page ── */}
          {currentPage === 'savings' && (
            <div className="page-section">
              <h1>Savings</h1>
              {term && (
                <div className="action-card" style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '0.95rem' }}>Term #{term.termId?.toString() || '0'}</span>
                    <span className={`loan-status ${term.distributed ? 'repaid' : 'active'}`}>{term.distributed ? 'Distributed' : 'Active'}</span>
                  </div>
                  <div className="term-bar-wrap">
                    <div className="term-bar-label"><span>Progress</span><span>{termPct}%</span></div>
                    <div className="term-bar"><div className="term-bar-fill" style={{ width: `${termPct}%` }} /></div>
                  </div>
                </div>
              )}
              <div className="actions-section">
                <div className="action-card">
                  <h2>Add Savings</h2>
                  <p className="card-desc">Contribute to the pool. Minimum {minContributionRwf.toLocaleString()} RWF.</p>
                  <div className="input-group">
                    <label>Amount (RWF)</label>
                    <input type="number" value={depositRwf} onChange={(e) => setDepositRwf(e.target.value)} placeholder={`e.g., ${minContributionRwf}`} min={minContributionRwf} step="1000" />
                  </div>
                  {depositRwf && parseFloat(depositRwf) > 0 && <div className="eth-equivalent">≈ {rwfToEthString(depositRwf)} ETH</div>}
                  <button className="btn-full" onClick={handleContribute} disabled={loading || !depositRwf}>
                    {loading ? <span className="spinner">⟳</span> : `Deposit ${depositRwf ? parseFloat(depositRwf).toLocaleString() : ''} RWF`}
                  </button>
                </div>
                <div className="action-card">
                  <h2>Withdraw Savings</h2>
                  <p className="card-desc">Withdraw your savings. Must have no active loan.</p>
                  <div className="input-group">
                    <label>Amount (RWF)</label>
                    <input type="number" value={withdrawRwf} onChange={(e) => setWithdrawRwf(e.target.value)} placeholder="e.g., 25000" min="1000" step="1000" />
                  </div>
                  {withdrawRwf && parseFloat(withdrawRwf) > 0 && <div className="eth-equivalent">≈ {rwfToEthString(withdrawRwf)} ETH</div>}
                  <div className="available-balance">Available: {getSavingsRwf()} RWF</div>
                  <button className="btn-danger" onClick={handleWithdraw} disabled={loading || !withdrawRwf || loanStatusKey === 'active'}>
                    {loanStatusKey === 'active' ? 'Repay loan first' : loading ? <span className="spinner">⟳</span> : 'Withdraw'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Loans Page ── */}
          {currentPage === 'loans' && (
            <div className="page-section">
              <h1>Loans</h1>
              <div className="actions-section">
                <div className="action-card">
                  <h2>Request a Loan</h2>
                  <p className="card-desc">Borrow up to 3× savings at 5% interest. Requires 2 leader approvals.</p>
                  {loanStatusKey === 'active' || loanStatusKey === 'pending' ? (
                    <div className="loan-info">
                      <div className="loan-info-row"><span>Principal</span><span>{loan ? fmtRWFDisplay(loan.principal) : '0'} RWF</span></div>
                      <div className="loan-info-row"><span>Total Owed</span><span>{loan ? fmtRWFDisplay(loan.totalOwed) : '0'} RWF</span></div>
                      <div className="loan-info-row"><span>Repaid</span><span>{loan ? fmtRWFDisplay(loan.amountRepaid) : '0'} RWF</span></div>
                      <div className="loan-info-row"><span>Remaining</span><span style={{ color: 'var(--red)' }}>{getLoanRemainingRwf()} RWF</span></div>
                      {loanStatusKey === 'active' && <div className="loan-info-row"><span>Deadline</span><span>{new Date(Number(loan.deadline) * 1000).toLocaleDateString()}</span></div>}
                      {loanStatusKey === 'pending' && <div className="loan-info-row"><span>Status</span><span>Waiting for 2 leader approvals</span></div>}
                    </div>
                  ) : (
                    <>
                      <div className="input-group">
                        <label>Loan Amount (RWF)</label>
                        <input type="number" value={loanRwf} onChange={(e) => setLoanRwf(e.target.value)} placeholder="e.g., 100000" min="10000" step="10000" />
                      </div>
                      {loanRwf && parseFloat(loanRwf) > 0 && <div className="eth-equivalent">≈ {rwfToEthString(loanRwf)} ETH</div>}
                      <div className="loan-limits">Max: {getMaxLoanRwf()} RWF · 5% interest · 30 days</div>
                      <button className="btn-full" onClick={handleRequestLoan} disabled={loading || !loanRwf}>
                        {loading ? <span className="spinner">⟳</span> : `Request ${loanRwf ? parseFloat(loanRwf).toLocaleString() : ''} RWF`}
                      </button>
                    </>
                  )}
                </div>
                <div className="action-card">
                  <h2>Repay Loan</h2>
                  <p className="card-desc">Partial or full repayment. Overpayment refunded.</p>
                  <div className="input-group">
                    <label>Repayment Amount (RWF)</label>
                    <input type="number" value={repayRwf} onChange={(e) => setRepayRwf(e.target.value)} placeholder="Enter any amount" min="1" step="1000" disabled={loanStatusKey !== 'active'} />
                  </div>
                  {repayRwf && parseFloat(repayRwf) > 0 && loanStatusKey === 'active' && <div className="eth-equivalent">≈ {rwfToEthString(repayRwf)} ETH</div>}
                  {loanStatusKey === 'active' && <div className="remaining-balance">Remaining: {getLoanRemainingRwf()} RWF</div>}
                  <button className="btn-green" onClick={handleRepay} disabled={loading || loanStatusKey !== 'active' || !repayRwf}>
                    {loanStatusKey !== 'active' ? 'No Active Loan' : loading ? <span className="spinner">⟳</span> : `Repay ${repayRwf ? parseFloat(repayRwf).toLocaleString() : ''} RWF`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Dividends Page ── */}
          {currentPage === 'dividends' && member && (
            <div className="page-section">
              <h1>Dividends</h1>
              <div className="actions-section">
                <div className="action-card">
                  <h2>Your Dividends</h2>
                  <p className="card-desc">80% of term interest distributed pro-rata.</p>
                  <div className="loan-info">
                    <div className="loan-info-row"><span>Pending</span><span style={{ color: 'var(--amber)' }}>{getPendingDivRwf()} RWF</span></div>
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

              {/* Dividend Projections Table */}
              <div className="dividend-projections">
                <div className="projections-header">
                  <h2>📊 Dividend Projections</h2>
                  <div className="projections-info">
                    <span>💰 Total Interest: {term ? fmtRWFDisplay(term.interestCollected) : '0'} RWF</span>
                    <span>🎯 Dividend Pool (80%): {totalDividendPool.toLocaleString()} RWF</span>
                  </div>
                </div>
                <div className="projections-table-wrapper">
                  <table className="projections-table">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Role</th>
                        <th>Savings (RWF)</th>
                        <th>% of Pool</th>
                        <th>Projected Dividend</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dividendProjections.map((proj, idx) => (
                        <tr key={idx} className={proj.address.toLowerCase() === account?.toLowerCase() ? 'current-user-row' : ''}>
                          <td>
                            <div className="member-cell">
                              <span className="member-avatar-small">{proj.name.charAt(0).toUpperCase()}</span>
                              <div>
                                <div className="member-name-cell">{proj.name}</div>
                                <div className="member-address-cell">{shortAddr(proj.address)}</div>
                              </div>
                              {proj.address.toLowerCase() === account?.toLowerCase() && <span className="you-badge">You</span>}
                            </div>
                          </td>
                          <td className="text-center">
                            <span className={`role-badge-small ${proj.role > 0 ? 'leader' : ''}`}>{proj.roleName}</span>
                          </td>
                          <td className="text-right">{proj.savingsRwf.toLocaleString()} RWF</td>
                          <td className="text-center">{proj.percentage}%</td>
                          <td className="text-right gold">{proj.projectedDividend.toLocaleString()} RWF</td>
                          <td className="text-center">
                            <span className={`status-badge ${proj.isActive ? 'active' : 'inactive'}`}>{proj.isActive ? 'Active' : 'Inactive'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="total-row">
                        <td><strong>Total</strong></td>
                        <td></td>
                        <td className="text-right"><strong>{totalSavings.toLocaleString()} RWF</strong></td>
                        <td className="text-center"><strong>100%</strong></td>
                        <td className="text-right"><strong>{totalDividendPool.toLocaleString()} RWF</strong></td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {term?.distributed && (
                  <div className="alert alert-success">✅ Dividends for Term #{term.termId?.toString()} have been distributed!</div>
                )}
                {term && !term.distributed && termPct >= 100 && (
                  <div className="alert alert-warning">⏰ Term has ended! Click "Distribute Dividends" above to distribute.</div>
                )}
                {term && !term.distributed && Number(fmtRWF(term.interestCollected)) === 0 && (
                  <div className="alert alert-info">💡 No interest collected yet. Dividends appear when members repay loans with interest.</div>
                )}
              </div>
            </div>
          )}

          {/* ── Admin Page ── */}
          {currentPage === 'admin' && isAdmin && (
            <div className="page-section">
              <h1>Admin Panel</h1>
              <div className="action-card">
                <h2>Register New Member</h2>
                <p className="card-desc">Assign a role to determine approval authority.</p>
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
                  <div className="input-group">
                    <label>Member Role</label>
                    <select value={regRole} onChange={(e) => setRegRole(parseInt(e.target.value))}>
                      <option value={0}>Regular Member</option>
                      <option value={1}>President (Can approve loans)</option>
                      <option value={2}>Accountant (Can approve loans)</option>
                      <option value={3}>Chief of Member (Can approve loans)</option>
                    </select>
                  </div>
                </div>
                <button className="btn-full" onClick={handleRegister} disabled={loading || !regWallet || !regName || !regEmail || !regPhone}>
                  {loading ? <span className="spinner">⟳</span> : 'Register Member'}
                </button>
              </div>

              {/* Pending requests visible to admin (read-only / reject only) */}
              {pendingReqs.length > 0 && (
                <div className="action-card" style={{ marginTop: '1.5rem' }}>
                  <h2>Pending Loan Requests ({pendingReqs.length})</h2>
                  <p className="card-desc">Awaiting leader approvals. Admin can only reject.</p>
                  {pendingReqs.map(r => {
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
                          <button className="btn-danger" onClick={() => handleRejectLoan(r.id)} disabled={loading}>
                            ✕ Reject
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="info-card" style={{ marginTop: '1.5rem' }}>
                <h3>📋 Role Information</h3>
                <ul>
                  <li><strong>President</strong> — Can approve loan requests</li>
                  <li><strong>Accountant</strong> — Can approve loan requests</li>
                  <li><strong>Chief of Member</strong> — Can approve loan requests</li>
                  <li><strong>Regular Member</strong> — Standard member, no approval authority</li>
                </ul>
                <p className="info-note">Loan requests require approval from at least 2 leaders before disbursement.</p>
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

// ── Sidebar Link ──────────────────────────────────────
function SidebarLink({ href, active, onClick, children }) {
  return (
    <a href={href} className={`sidebar-link ${active ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); onClick(); }}>
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