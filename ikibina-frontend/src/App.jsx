import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESS, ABI, LOAN_STATUS, MEMBER_ROLES, POOL_SAFETY } from './contracts/config';
import './App.css';

// ── Constants ──────────────────────────────────────────
const ETH_RWF_RATE = 8500000;
const WEI_PER_ETH  = 1000000000000000000n;
const WEI_PER_RWF  = WEI_PER_ETH / BigInt(ETH_RWF_RATE);

// ── Toast ──────────────────────────────────────────────
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
const fmtETH        = (wei) => !wei ? '0' : (Number(wei) / Number(WEI_PER_ETH)).toFixed(8);
const fmtRWF        = (wei) => !wei ? '0' : (BigInt(wei) / WEI_PER_RWF).toString();
const fmtRWFDisplay = (wei) => !wei ? '0' : Number(BigInt(wei) / WEI_PER_RWF).toLocaleString();
const rwfToWei      = (rwf) => (!rwf || parseFloat(rwf) <= 0) ? 0n : BigInt(Math.floor(parseFloat(rwf))) * WEI_PER_RWF;
const rwfToEthStr   = (rwf) => (Number(rwfToWei(rwf)) / Number(WEI_PER_ETH)).toFixed(10);
const shortAddr     = (a)   => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
const isLeaderRole  = (r)   => r === 1 || r === 2 || r === 3;

const termProgress = (start, end) => {
  const now = Date.now() / 1000;
  return Math.max(0, Math.min(100, ((now - Number(start)) / (Number(end) - Number(start))) * 100)).toFixed(1);
};

// ── App ────────────────────────────────────────────────
export default function App() {
  const { toasts, show } = useToast();

  // wallet / identity
  const [account,              setAccount]              = useState(null);
  const [isAdmin,              setIsAdmin]              = useState(false);
  const [canRegisterMembers,  setCanRegisterMembers]  = useState(false);
  const [userRole,             setUserRole]             = useState(null);

  const [isAuthorizedApprover, setIsAuthorizedApprover] = useState(false);
  const [loading,              setLoading]              = useState(false);
  const [ethBalance,           setEthBalance]           = useState('0');

  // contract state
  const [member,       setMember]       = useState(null);
  const [loan,         setLoan]         = useState(null);
  const [term,         setTerm]         = useState(null);
  const [totalPool,    setTotalPool]    = useState('0');
  const [reservePool,  setReservePool]  = useState('0');
  const [memberCount,  setMemberCount]  = useState('0');
  const [contractBal,  setContractBal]  = useState('0');
  const [pendingReqs,  setPendingReqs]  = useState([]);

  // approvals — only requests the current leader CAN act on
  // (borrower !== self)
  const [pendingApprovals, setPendingApprovals] = useState([]);

  // members
  const [allMembers,     setAllMembers]     = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [memberSearch,   setMemberSearch]   = useState('');
  const [showMemberModal,setShowMemberModal] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // nav
  const [currentPage, setCurrentPage] = useState('profile');

  // registration
  const [regName,   setRegName]   = useState('');
  const [regEmail,  setRegEmail]  = useState('');
  const [regPhone,  setRegPhone]  = useState('');
  const [regWallet, setRegWallet] = useState('');
  const [regRole,   setRegRole]   = useState(0);

  // amounts
  const [depositRwf, setDepositRwf] = useState('');
  const [withdrawRwf,setWithdrawRwf] = useState('');
  const [loanRwf,    setLoanRwf]    = useState('');
  const [repayRwf,   setRepayRwf]   = useState('');

  // ── wallet/provider helpers ────────────────────────────
  const hasInjectedProvider = () => typeof window !== 'undefined' && !!window.ethereum;

  const getProvider = () => {
    if (!hasInjectedProvider()) {
      throw new Error('Wallet provider not found (window.ethereum is missing)');
    }
    return new ethers.BrowserProvider(window.ethereum);
  };

  const getContract = async (write = false) => {
    const p = getProvider();
    return new ethers.Contract(CONTRACT_ADDRESS, ABI, write ? await p.getSigner() : p);
  };

  // ── Fetch pending approvals ───────────────────────────
  // Key rule: skip any request where borrower === walletAddr
  // (a leader cannot approve their own loan)
  const fetchPendingApprovalsWithValues = useCallback(async (walletAddr, adminMatch, resolvedRole) => {
    if (adminMatch || !isLeaderRole(resolvedRole)) return;
    try {
      const c = await getContract();
      const reqCount = Number(await c.loanRequestCount());
      const approvals = [];

      for (let i = reqCount - 1; i >= Math.max(0, reqCount - 20); i--) {
        try {
          const r = await c.getLoanRequest(i);
          if (!r || r.approved || r.rejected) continue;

          // ✅ Skip if this leader IS the borrower — they cannot approve their own loan
          if (r.borrower?.toLowerCase() === walletAddr.toLowerCase()) continue;

          approvals.push({
            id: i,
            borrower: r.borrower,
            amount: r.amount,
            requestedAt: r.requestedAt,
          });
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

  // ── All members ───────────────────────────────────────
  const fetchAllMembers = useCallback(async () => {
    if (!account || !hasInjectedProvider()) return;
    setLoadingMembers(true);
    try {
      const c = await getContract();
      const addrs = await c.getMemberList();
      if (!addrs?.length) { setAllMembers([]); return; }

      const data = [];
      for (const addr of addrs) {
        try {
          const m = await c.getMember(addr);
          if (!m?.isRegistered) continue;
          let ld = { status: 0, principal: 0, totalOwed: 0, amountRepaid: 0 };
          try { ld = await c.getLoan(addr); } catch (_) {}
          data.push({
            address: addr,
            name: m.name, email: m.email, phone: m.phone,
            isActive: m.isActive,
            savings: m.savings,
            pendingDividends: m.pendingDividends,
            joinedAt: m.joinedAt,
            role: Number(m.role) || 0,
            hasActiveLoan: Number(ld.status) === 1 || Number(ld.status) === 2,
            loanAmount: ld.principal,
            loanStatus: Number(ld.status),
            loanTotalOwed: ld.totalOwed,
            loanAmountRepaid: ld.amountRepaid,
          });
        } catch (err) { console.error(`Error fetching member ${addr}:`, err); }
      }
      setAllMembers(data);
    } catch (err) { console.error('fetchAllMembers error:', err); setAllMembers([]); }
    finally { setLoadingMembers(false); }
  }, [account]);

  // ── Validation ────────────────────────────────────────
  const validateRwfAmount = (amount, type = 'deposit') => {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) return { valid: false, error: 'Please enter a valid amount in RWF' };
    const wei = rwfToWei(amount);
    const eth = Number(wei) / Number(WEI_PER_ETH);

    if (type === 'deposit') {
      if (eth < 0.001 - 0.0000001) return { valid: false, error: `Minimum contribution is ${Math.ceil(0.001 * ETH_RWF_RATE).toLocaleString()} RWF` };
      return { valid: true, rwf: num, wei, eth };
    }
    if (type === 'repay') {
      const lsk = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';
      if (lsk !== 'active') return { valid: false, error: 'No active loan to repay' };
      const rem = Number(BigInt(loan.remainingOwed) / WEI_PER_RWF);
      if (num > rem) return { valid: false, error: `Exceeds remaining ${rem.toLocaleString()} RWF` };
      return { valid: true, rwf: num, wei, eth };
    }
    if (type === 'withdraw') {
      if (!member) return { valid: false, error: 'Not a registered member' };
      if (wei > BigInt(member.savings)) return { valid: false, error: 'Insufficient savings balance' };
      if (loan && LOAN_STATUS[Number(loan.status)]?.toLowerCase() === 'active')
        return { valid: false, error: 'Repay active loan first' };
      return { valid: true, rwf: num, wei, eth };
    }
    if (type === 'loan') {
      if (!member) return { valid: false, error: 'Not a registered member' };
      const max = BigInt(member.savings) * 3n;
      if (wei > max) return { valid: false, error: `Maximum loan is ${Number(max / WEI_PER_RWF).toLocaleString()} RWF` };
      const lsk = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';
      if (lsk === 'active' || lsk === 'pending') return { valid: false, error: 'You already have an active or pending loan' };
      return { valid: true, rwf: num, wei, eth };
    }
    return { valid: false, error: 'Invalid type' };
  };

  // ── tx helper ─────────────────────────────────────────
  const tx = async (fn, successMsg, valueWei = null) => {
    setLoading(true);
    try {
      const t = await (valueWei !== null ? fn(valueWei) : fn());
      show('Transaction sent — waiting…', 'info');
      await t.wait();
      show(successMsg, 'success');
      await refreshAll(account);
    } catch (e) {
      const reason = e.reason || e.error?.message
        || e.message?.match(/execution reverted: (.+?)"/)?.[1]
        || e.message?.slice(0, 160) || 'Transaction failed';
      show(reason, 'error');
    } finally { setLoading(false); }
  };

  // ── Refresh all data ──────────────────────────────────
  const refreshAll = useCallback(async (addr) => {
    const wallet = addr || account;
    if (!wallet || !window.ethereum) return;
    try {
      const c = await getContract();
      const provider = getProvider();

      const balance = await provider.getBalance(wallet);
      setEthBalance(ethers.formatEther(balance));

      const [adminAddr, pool, reserve, mCount, bal, termData] = await Promise.all([
        c.admin(), c.totalPool(), c.reservePool(),
        c.memberCount(), c.contractBalance(), c.getCurrentTerm(),
      ]);

      const adminMatch = adminAddr?.toLowerCase() === wallet.toLowerCase();
      setIsAdmin(adminMatch);

      // register authorization can be admin OR any memberAdder (canAddMembers)
      // (contract uses onlyAdminOrMemberAdder)
      let canRegister = false;
      try {
        // expects ABI for canAddMembers(address)
        canRegister = await c.canAddMembers(wallet);
      } catch (e) {
        // fallback: keep admin-only behavior if method isn't in ABI
        canRegister = adminMatch;
      }
      setCanRegisterMembers(!!canRegister);

      setTotalPool(fmtETH(pool));
      setReservePool(fmtETH(reserve));
      setMemberCount(Number(mCount).toString());
      setContractBal(fmtETH(bal));
      setTerm(termData);

      const m = await c.getMember(wallet);
      const registered = m?.isRegistered && m?.isActive;
      setMember(registered ? m : null);

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
      } else { setLoan(null); }

      // pending reqs for admin display
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

      // ✅ Pass fresh values — never read stale React state here
      await fetchPendingApprovalsWithValues(wallet, adminMatch, resolvedRole);

    } catch (e) { console.error('refreshAll error:', e); }
  }, [account, fetchAllMembers, fetchPendingApprovalsWithValues]);

  // ── Connect wallet ────────────────────────────────────
  const connectWallet = async () => {
    if (!hasInjectedProvider()) {
      show(
        'Wallet not detected (window.ethereum missing). Install MetaMask or ensure it is enabled.',
        'error'
      );
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0]);
      await refreshAll(accounts[0]);
    } catch {
      show('Connection rejected', 'error');
    }
  };

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden && account) {
        fetchAllMembers();
        if (!isAdmin && isLeaderRole(userRole)) fetchPendingApprovals();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [account, isAdmin, userRole, fetchAllMembers, fetchPendingApprovals]);

  useEffect(() => {
    if (!hasInjectedProvider()) return;
    const onAccChange = (accs) => {
      setAccount(accs[0] || null);
      if (accs[0]) refreshAll(accs[0]);
    };
    window.ethereum.on('accountsChanged', onAccChange);
    return () => window.ethereum.removeListener('accountsChanged', onAccChange);
  }, [refreshAll]);

  // ── Transaction handlers ──────────────────────────────
  const handleRegister = () => {
    if (!canRegisterMembers) { show('You are not authorized to register members', 'error'); return; }
    tx(async () => (await getContract(true)).register(regName, regEmail, regPhone, regWallet, regRole),
      `Registered ${shortAddr(regWallet)} as ${MEMBER_ROLES[regRole]}!`);
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
    tx(async () => (await getContract(true)).requestLoan(v.wei), `Loan of ${v.rwf.toLocaleString()} RWF requested!`);
    setLoanRwf('');
  };

  const handleRepay = () => {
    const v = validateRwfAmount(repayRwf, 'repay');
    if (!v.valid) { show(v.error, 'error'); return; }
    tx(async (value) => (await getContract(true)).repayLoan({ value }), `${v.rwf.toLocaleString()} RWF repaid!`, v.wei);
    setRepayRwf('');
  };

  const handleClaimDividends    = () => tx(async () => (await getContract(true)).claimDividends(),      'Dividends claimed!');
  const handleDistributeDividends = () => tx(async () => (await getContract(true)).distributeDividends(), 'Dividends distributed!');

  // ── Approve loan ──────────────────────────────────────
  // Uses ABI function: approveLoan(uint256 _requestId)
  // Guard: leader cannot approve their own loan — enforced in fetchPendingApprovalsWithValues
  // (their own request never appears in pendingApprovals), but we double-check here too.
  const handleApproveLoan = async (requestId, borrowerAddr) => {
    if (isAdmin || !isLeaderRole(userRole)) {
      show('Only leaders can approve loans', 'error'); return;
    }
    if (borrowerAddr?.toLowerCase() === account?.toLowerCase()) {
      show('You cannot approve your own loan request', 'error'); return;
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
      show(e.reason || e.message?.slice(0, 160) || 'Transaction failed', 'error');
    } finally { setLoading(false); }
  };

  const handleRejectLoan = (id) =>
    tx(async () => (await getContract(true)).rejectLoan(id), `Loan #${id} rejected.`);

  const handleViewMember    = (m) => { setSelectedMember(m); setShowMemberModal(true); };
  const handleRefreshMembers = async () => { await fetchAllMembers(); show('Member list refreshed!', 'success'); };

  // ── Derived helpers ───────────────────────────────────
  const loanStatusKey     = loan ? LOAN_STATUS[Number(loan.status)]?.toLowerCase() : 'none';
  const getSavingsRwf     = () => member ? fmtRWFDisplay(member.savings) : '0';
  const getMaxLoanRwf     = () => member ? Number(BigInt(member.savings) * 3n / WEI_PER_RWF).toLocaleString() : '0';
  const getPendingDivRwf  = () => member ? fmtRWFDisplay(member.pendingDividends) : '0';
  const getLoanRemRwf     = () => (loan && loanStatusKey === 'active') ? Number(BigInt(loan.remainingOwed) / WEI_PER_RWF).toLocaleString() : '0';
  const getTotalPoolRwf   = () => totalPool === '0' ? '0' : Number(BigInt(Math.floor(parseFloat(totalPool) * Number(WEI_PER_ETH))) / WEI_PER_RWF).toLocaleString();
  const getReserveRwf     = () => reservePool === '0' ? '0' : Number(BigInt(Math.floor(parseFloat(reservePool) * Number(WEI_PER_ETH))) / WEI_PER_RWF).toLocaleString();
  const getUserRoleName   = () => isAdmin ? 'Admin' : (userRole != null ? MEMBER_ROLES[userRole] || 'Member' : 'Member');

  const hasDividends       = member && BigInt(member.pendingDividends || 0) > 0n;
  const termPct            = term ? termProgress(term.startTime, term.endTime) : 0;
  const minContribRwf      = Math.ceil(0.001 * ETH_RWF_RATE);
  const showApprovalsLink  = !isAdmin && isLeaderRole(userRole);

  // ── Dividend projections ──────────────────────────────
  const calcProjections = () => {
    if (!term || !allMembers.length) return [];
    const intWei   = BigInt(term.interestCollected || 0);
    const divPool  = (intWei * 8000n) / 10000n;
    const totalSav = allMembers.reduce((s, m) => s + (m.isActive ? BigInt(m.savings) : 0n), 0n);
    return allMembers.map(m => {
      const sw = BigInt(m.savings);
      const pct = totalSav > 0n && m.isActive ? Number((sw * 10000n) / totalSav) / 100 : 0;
      const div = totalSav > 0n && m.isActive ? (divPool * sw) / totalSav : 0n;
      return { ...m, savingsRwf: Number(sw / WEI_PER_RWF), percentage: pct, projectedDividend: Number(div / WEI_PER_RWF) };
    }).sort((a, b) => b.projectedDividend - a.projectedDividend);
  };
  const projections      = calcProjections();
  const totalSavingsRwf  = allMembers.reduce((s, m) => s + Number(BigInt(m.savings) / WEI_PER_RWF), 0);
  const totalDivPoolRwf  = term ? Number((BigInt(term.interestCollected || 0) * 8000n) / 10000n / WEI_PER_RWF) : 0;

  const filteredMembers = allMembers.filter(m =>
    m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.email.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.phone.includes(memberSearch) ||
    shortAddr(m.address).toLowerCase().includes(memberSearch.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────
  if (!account) return (
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

  return (
    <div className="dashboard-layout">

      {/* ── Header ── */}
      <header className="dashboard-header">
        <div className="header-brand"><h1>Ikimina</h1><span>Web3 Savings - RWF</span></div>
        <div className="header-actions">
          {(isAdmin || canRegisterMembers) && <span className="admin-badge">⚙ Admin</span>}
          {!isAdmin && userRole > 0 && <span className="role-badge">{getUserRoleName()}</span>}
          <span className="network-badge">Sepolia</span>
          <div className="eth-balance">
            <span className="balance-label">ETH Balance:</span>
            <span className="balance-value">{parseFloat(ethBalance).toFixed(4)} ETH</span>
          </div>
          <button className="btn-primary" onClick={connectWallet} disabled={loading}>
            {shortAddr(account)}{loading && <span className="spinner">⟳</span>}
          </button>
        </div>
      </header>

      <div className="dashboard-main">

        {/* ── Sidebar ── */}
        <aside className="dashboard-sidebar">
          <nav className="sidebar-nav">
            <SidebarLink href="#profile"   active={currentPage==='profile'}   onClick={()=>setCurrentPage('profile')}>👤 My Profile</SidebarLink>
            <SidebarLink href="#members"   active={currentPage==='members'}   onClick={()=>setCurrentPage('members')}>
              👥 Member Directory {allMembers.length > 0 && <span className="nav-badge">{allMembers.length}</span>}
            </SidebarLink>
            <SidebarLink href="#savings"   active={currentPage==='savings'}   onClick={()=>setCurrentPage('savings')}>💰 Savings</SidebarLink>
            <SidebarLink href="#loans"     active={currentPage==='loans'}     onClick={()=>setCurrentPage('loans')}>📈 Loans</SidebarLink>
            <SidebarLink href="#dividends" active={currentPage==='dividends'} onClick={()=>setCurrentPage('dividends')}>📊 Dividends</SidebarLink>

            {/* Loan Approvals — leaders only, NOT admin */}
            {showApprovalsLink && (
              <SidebarLink href="#approvals" active={currentPage==='approvals'} onClick={()=>setCurrentPage('approvals')}>
                ✓ Loan Approvals
                {pendingApprovals.length > 0 && <span className="nav-badge">{pendingApprovals.length}</span>}
              </SidebarLink>
            )}

            {(isAdmin || canRegisterMembers) && (
              <SidebarLink href="#admin" active={currentPage==='admin'} onClick={()=>setCurrentPage('admin')}>⚙ Admin</SidebarLink>
            )}
          </nav>
        </aside>

        {/* ── Main ── */}
        <main className="dashboard-content">

          {/* Profile */}
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
                        <button className="copy-btn" onClick={()=>{ navigator.clipboard.writeText(account); show('Copied!','success'); }} title="Copy">⎘</button>
                      </div>
                    </div>
                  </div>
                  <div className="exchange-rate-banner">
                    💱 Fixed Exchange Rate: 1 ETH = {ETH_RWF_RATE.toLocaleString()} RWF
                    <span className="rate-note">(Exact integer math — no rounding errors)</span>
                  </div>
                  <div className="stats-grid">
                    <div className="stat-card" style={{'--accent-color':'var(--gold)'}}>
                      <div className="stat-label">My Savings</div>
                      <div className="stat-value gold">{getSavingsRwf()} RWF</div>
                      <div className="stat-sub">≈ {fmtETH(member.savings)} ETH</div>
                      <div className="stat-sub">Max loan: {getMaxLoanRwf()} RWF</div>
                    </div>
                    <div className="stat-card" style={{'--accent-color':'var(--green)'}}>
                      <div className="stat-label">Total Pool</div>
                      <div className="stat-value green">{getTotalPoolRwf()} RWF</div>
                      <div className="stat-sub">≈ {totalPool} ETH</div>
                      <div className="stat-sub">Reserve: {getReserveRwf()} RWF</div>
                    </div>
                    <div className="stat-card" style={{'--accent-color':'var(--blue)'}}>
                      <div className="stat-label">Loan Status</div>
                      <div style={{marginTop:'0.4rem'}}>
                        <span className={`loan-status ${loanStatusKey}`}>
                          {loan && LOAN_STATUS[Number(loan.status)] ? LOAN_STATUS[Number(loan.status)] : 'None'}
                        </span>
                      </div>
                      {loanStatusKey === 'active' && <div className="stat-sub">Due: {new Date(Number(loan.deadline)*1000).toLocaleDateString()}</div>}
                      {loanStatusKey === 'pending' && <div className="stat-sub">Awaiting 2 leader approvals</div>}
                    </div>
                    <div className="stat-card" style={{'--accent-color':'var(--amber)'}}>
                      <div className="stat-label">Pending Dividends</div>
                      <div className="stat-value amber">{getPendingDivRwf()} RWF</div>
                      <div className="stat-sub">≈ {fmtETH(member.pendingDividends)} ETH</div>
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

          {/* Member Directory */}
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
                  <input type="text" placeholder="Search by name, email, phone, or address..."
                    value={memberSearch} onChange={e=>setMemberSearch(e.target.value)} />
                </div>
                <div className="directory-stats">
                  Total: {allMembers.length} | Active: {allMembers.filter(m=>m.isActive).length}
                </div>
              </div>
              {loadingMembers ? (
                <div className="loading-state"><div className="spinner-large"/><p>Loading from blockchain…</p></div>
              ) : allMembers.length === 0 ? (
                <div className="empty-state">
                  <p>No members found.</p>
              {(isAdmin || canRegisterMembers)
                    ? <button className="btn-primary" onClick={()=>setCurrentPage('admin')} style={{marginTop:'1rem',width:'auto'}}>Go to Admin Panel</button>
                    : <p>Ask the admin to register members.</p>}
                </div>
              ) : (
                <div className="members-grid">
                  {filteredMembers.map((m, idx) => (
                    <div key={idx} className="member-card" onClick={()=>handleViewMember(m)}>
                      <div className="member-avatar">{m.name.charAt(0).toUpperCase()}</div>
                      <div className="member-info">
                        <div className="member-name">
                          {m.name}
                          {m.role > 0 && <span className="role-tag">{MEMBER_ROLES[m.role]}</span>}
                        </div>
                        <div className="member-details"><span>📧 {m.email}</span><span>📞 {m.phone}</span></div>
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
            <div className="modal-overlay" onClick={()=>setShowMemberModal(false)}>
              <div className="modal-content" onClick={e=>e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Member Details</h2>
                  <button className="modal-close" onClick={()=>setShowMemberModal(false)}>✕</button>
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
                    <h4>Wallet</h4>
                    <div className="detail-row">
                      <span>Address:</span><code>{selectedMember.address}</code>
                      <button className="copy-btn-small" onClick={()=>{ navigator.clipboard.writeText(selectedMember.address); show('Copied!','success'); }}>Copy</button>
                    </div>
                  </div>
                  <div className="detail-section">
                    <h4>Financials</h4>
                    <div className="stats-mini-grid">
                      <div className="stat-mini"><label>Savings</label><value>{fmtRWFDisplay(selectedMember.savings)} RWF</value></div>
                      <div className="stat-mini"><label>Pending Dividends</label><value>{fmtRWFDisplay(selectedMember.pendingDividends)} RWF</value></div>
                      <div className="stat-mini"><label>Status</label><value className={selectedMember.isActive?'active':'inactive'}>{selectedMember.isActive?'Active':'Inactive'}</value></div>
                      <div className="stat-mini"><label>Joined</label><value>{new Date(Number(selectedMember.joinedAt)*1000).toLocaleDateString()}</value></div>
                    </div>
                  </div>
                  {selectedMember.hasActiveLoan && (
                    <div className="detail-section">
                      <h4>Loan</h4>
                      <div className="detail-row"><span>Amount:</span><strong>{fmtRWFDisplay(selectedMember.loanAmount)} RWF</strong></div>
                      <div className="detail-row"><span>Total Owed:</span><strong>{fmtRWFDisplay(selectedMember.loanTotalOwed)} RWF</strong></div>
                      <div className="detail-row"><span>Repaid:</span><strong>{fmtRWFDisplay(selectedMember.loanAmountRepaid)} RWF</strong></div>
                      <div className="detail-row">
                        <span>Status:</span>
                        <span className={`loan-status ${selectedMember.loanStatus===2?'active':'pending'}`}>
                          {selectedMember.loanStatus===2?'Active':'Pending'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Loan Approvals — Leaders ONLY ── */}
          {currentPage === 'approvals' && showApprovalsLink && (
            <div className="page-section">
              <h1>Loan Approvals</h1>

              <div className="approvals-info">
                <div className="leader-info">
                  <span className="role-badge">{getUserRoleName()}</span>
                  <p>
                    As <strong>{getUserRoleName()}</strong>, you can approve loan requests from other members.
                    Each loan requires <strong>2 leader approvals</strong> before funds are disbursed.
                  </p>
                </div>
              </div>

              {/* ✅ Self-loan notice — shown when the logged-in leader has a pending loan */}
              {pendingReqs.some(r => r.borrower?.toLowerCase() === account?.toLowerCase()) && (
                <div className="alert alert-info" style={{marginBottom:'1rem'}}>
                  ℹ️ You have a pending loan request. The other leaders will review and approve it — you cannot approve your own loan.
                </div>
              )}

              <div className="pending-requests">
                <h2>Requests You Can Approve ({pendingApprovals.length})</h2>

                {pendingApprovals.length === 0 ? (
                  <div className="empty-state">
                    <p>✅ No pending requests for you to approve right now.</p>
                  </div>
                ) : (
                  pendingApprovals.map(r => {
                    const borrowerInfo = allMembers.find(m => m.address.toLowerCase() === r.borrower?.toLowerCase());
                    return (
                      <div key={r.id} className="request-card">
                        <div className="request-info">
                          <div className="request-borrower">
                            <strong>{borrowerInfo?.name || shortAddr(r.borrower)}</strong>
                            <small>{shortAddr(r.borrower)}</small>
                            {borrowerInfo?.role > 0 && (
                              <span className="role-tag" style={{marginLeft:'0.4rem'}}>
                                {MEMBER_ROLES[borrowerInfo.role]}
                              </span>
                            )}
                          </div>
                          <div className="request-amount">{fmtRWFDisplay(r.amount)} RWF</div>
                          <div className="request-date">{new Date(Number(r.requestedAt)*1000).toLocaleString()}</div>
                        </div>
                        <div className="request-actions">
                          <button className="btn-approve" onClick={()=>handleApproveLoan(r.id, r.borrower)} disabled={loading}>
                            {loading ? '⟳ Processing...' : `✓ Approve as ${getUserRoleName()}`}
                          </button>
                          <button className="btn-danger" onClick={()=>handleRejectLoan(r.id)} disabled={loading} style={{marginTop:'0.5rem'}}>
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
                  <li><strong>Step 1:</strong> Any member (including a leader) requests a loan</li>
                  <li><strong>Step 2:</strong> The request appears in other leaders' approval panels</li>
                  <li><strong>Step 3:</strong> If a <strong>leader is the borrower</strong>, their own request is hidden from their panel — the <strong>other leaders</strong> approve it</li>
                  <li><strong>Step 4:</strong> When <strong>2 leaders approve</strong>, the loan is automatically disbursed</li>
                  <li><strong>Step 5:</strong> Borrower receives funds in their wallet</li>
                </ul>
                <p className="info-note">💡 No leader can approve their own loan — community oversight is always maintained.</p>
              </div>
            </div>
          )}

          {/* Savings */}
          {currentPage === 'savings' && (
            <div className="page-section">
              <h1>Savings</h1>
              {term && (
                <div className="action-card" style={{marginBottom:'1.25rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem'}}>
                    <span style={{fontWeight:700}}>Term #{term.termId?.toString()||'0'}</span>
                    <span className={`loan-status ${term.distributed?'repaid':'active'}`}>{term.distributed?'Distributed':'Active'}</span>
                  </div>
                  <div className="term-bar-wrap">
                    <div className="term-bar-label"><span>Progress</span><span>{termPct}%</span></div>
                    <div className="term-bar"><div className="term-bar-fill" style={{width:`${termPct}%`}}/></div>
                  </div>
                </div>
              )}
              <div className="actions-section">
                <div className="action-card">
                  <h2>Add Savings</h2>
                  <p className="card-desc">Minimum {minContribRwf.toLocaleString()} RWF.</p>
                  <div className="input-group">
                    <label>Amount (RWF)</label>
                    <input type="number" value={depositRwf} onChange={e=>setDepositRwf(e.target.value)} placeholder={`e.g. ${minContribRwf}`} min={minContribRwf} step="1000"/>
                  </div>
                  {depositRwf > 0 && <div className="eth-equivalent">≈ {rwfToEthStr(depositRwf)} ETH</div>}
                  <button className="btn-full" onClick={handleContribute} disabled={loading||!depositRwf}>
                    {loading?<span className="spinner">⟳</span>:`Deposit ${depositRwf?parseFloat(depositRwf).toLocaleString():''} RWF`}
                  </button>
                </div>
                <div className="action-card">
                  <h2>Withdraw Savings</h2>
                  <p className="card-desc">Requires no active loan.</p>
                  <div className="input-group">
                    <label>Amount (RWF)</label>
                    <input type="number" value={withdrawRwf} onChange={e=>setWithdrawRwf(e.target.value)} placeholder="e.g. 25000" step="1000"/>
                  </div>
                  {withdrawRwf > 0 && <div className="eth-equivalent">≈ {rwfToEthStr(withdrawRwf)} ETH</div>}
                  <div className="available-balance">Available: {getSavingsRwf()} RWF</div>
                  <button className="btn-danger" onClick={handleWithdraw} disabled={loading||!withdrawRwf||loanStatusKey==='active'}>
                    {loanStatusKey==='active'?'Repay loan first':loading?<span className="spinner">⟳</span>:'Withdraw'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Loans */}
          {currentPage === 'loans' && (
            <div className="page-section">
              <h1>Loans</h1>
              <div className="actions-section">
                <div className="action-card">
                  <h2>Request a Loan</h2>
                  <p className="card-desc">Borrow up to 3× savings at 5% interest. Requires 2 leader approvals.</p>
                  {loanStatusKey==='active'||loanStatusKey==='pending' ? (
                    <div className="loan-info">
                      <div className="loan-info-row"><span>Principal</span><span>{fmtRWFDisplay(loan?.principal)} RWF</span></div>
                      <div className="loan-info-row"><span>Total Owed</span><span>{fmtRWFDisplay(loan?.totalOwed)} RWF</span></div>
                      <div className="loan-info-row"><span>Repaid</span><span>{fmtRWFDisplay(loan?.amountRepaid)} RWF</span></div>
                      <div className="loan-info-row"><span>Remaining</span><span style={{color:'var(--red)'}}>{getLoanRemRwf()} RWF</span></div>
                      {loanStatusKey==='active' && <div className="loan-info-row"><span>Deadline</span><span>{new Date(Number(loan.deadline)*1000).toLocaleDateString()}</span></div>}
                      {loanStatusKey==='pending' && <div className="loan-info-row"><span>Status</span><span>⏳ Awaiting 2 leader approvals</span></div>}
                    </div>
                  ) : (
                    <>
                      <div className="input-group">
                        <label>Loan Amount (RWF)</label>
                        <input type="number" value={loanRwf} onChange={e=>setLoanRwf(e.target.value)} placeholder="e.g. 100000" step="10000"/>
                      </div>
                      {loanRwf > 0 && <div className="eth-equivalent">≈ {rwfToEthStr(loanRwf)} ETH</div>}
                      <div className="loan-limits">Max: {getMaxLoanRwf()} RWF · 5% interest · 30 days</div>
                      <button className="btn-full" onClick={handleRequestLoan} disabled={loading||!loanRwf}>
                        {loading?<span className="spinner">⟳</span>:`Request ${loanRwf?parseFloat(loanRwf).toLocaleString():''} RWF`}
                      </button>
                    </>
                  )}
                </div>
                <div className="action-card">
                  <h2>Repay Loan</h2>
                  <p className="card-desc">Partial or full. Overpayment refunded.</p>
                  <div className="input-group">
                    <label>Repayment Amount (RWF)</label>
                    <input type="number" value={repayRwf} onChange={e=>setRepayRwf(e.target.value)} placeholder="Any amount" step="1000" disabled={loanStatusKey!=='active'}/>
                  </div>
                  {repayRwf > 0 && loanStatusKey==='active' && <div className="eth-equivalent">≈ {rwfToEthStr(repayRwf)} ETH</div>}
                  {loanStatusKey==='active' && <div className="remaining-balance">Remaining: {getLoanRemRwf()} RWF</div>}
                  <button className="btn-green" onClick={handleRepay} disabled={loading||loanStatusKey!=='active'||!repayRwf}>
                    {loanStatusKey!=='active'?'No Active Loan':loading?<span className="spinner">⟳</span>:`Repay ${repayRwf?parseFloat(repayRwf).toLocaleString():''} RWF`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Dividends */}
          {currentPage === 'dividends' && member && (
            <div className="page-section">
              <h1>Dividends</h1>
              <div className="actions-section">
                <div className="action-card">
                  <h2>Your Dividends</h2>
                  <p className="card-desc">80% of term interest, distributed pro-rata by savings.</p>
                  <div className="loan-info">
                    <div className="loan-info-row"><span>Pending</span><span style={{color:'var(--amber)'}}>{getPendingDivRwf()} RWF</span></div>
                    <div className="loan-info-row"><span>Your Savings</span><span>{getSavingsRwf()} RWF</span></div>
                    <div className="loan-info-row"><span>Term Interest</span><span>{term?fmtRWFDisplay(term.interestCollected):'—'} RWF</span></div>
                  </div>
                  <button className="btn-full" onClick={handleClaimDividends} disabled={loading||!hasDividends}>
                    {!hasDividends?'No Dividends':loading?<span className="spinner">⟳</span>:'Claim Dividends'}
                  </button>
                </div>
                <div className="action-card">
                  <h2>Distribute Dividends</h2>
                  <p className="card-desc">Trigger at term end to credit all members.</p>
                  {term && (
                    <div className="loan-info">
                      <div className="loan-info-row"><span>Term Ends</span><span>{new Date(Number(term.endTime)*1000).toLocaleDateString()}</span></div>
                      <div className="loan-info-row"><span>Progress</span><span>{termPct}%</span></div>
                    </div>
                  )}
                  <button className="btn-full" onClick={handleDistributeDividends} disabled={loading||!term||term.distributed||termPct<100}>
                    {term?.distributed?'Done':termPct<100?`Term ${termPct}%`:loading?<span className="spinner">⟳</span>:'Distribute'}
                  </button>
                </div>
              </div>

              <div className="dividend-projections">
                <div className="projections-header">
                  <h2>📊 Dividend Projections</h2>
                  <div className="projections-info">
                    <span>💰 Interest: {term?fmtRWFDisplay(term.interestCollected):'0'} RWF</span>
                    <span>🎯 Dividend Pool (80%): {totalDivPoolRwf.toLocaleString()} RWF</span>
                  </div>
                </div>
                <div className="projections-table-wrapper">
                  <table className="projections-table">
                    <thead>
                      <tr><th>Member</th><th>Role</th><th>Savings (RWF)</th><th>%</th><th>Projected Dividend</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {projections.map((p, i) => (
                        <tr key={i} className={p.address.toLowerCase()===account?.toLowerCase()?'current-user-row':''}>
                          <td>
                            <div className="member-cell">
                              <span className="member-avatar-small">{p.name.charAt(0).toUpperCase()}</span>
                              <div>
                                <div className="member-name-cell">{p.name}</div>
                                <div className="member-address-cell">{shortAddr(p.address)}</div>
                              </div>
                              {p.address.toLowerCase()===account?.toLowerCase()&&<span className="you-badge">You</span>}
                            </div>
                          </td>
                          <td className="text-center">
                            <span className={`role-badge-small ${p.role>0?'leader':''}`}>{MEMBER_ROLES[p.role]||'Regular'}</span>
                          </td>
                          <td className="text-right">{p.savingsRwf.toLocaleString()} RWF</td>
                          <td className="text-center">{p.percentage.toFixed(1)}%</td>
                          <td className="text-right gold">{p.projectedDividend.toLocaleString()} RWF</td>
                          <td className="text-center">
                            <span className={`status-badge ${p.isActive?'active':'inactive'}`}>{p.isActive?'Active':'Inactive'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="total-row">
                        <td><strong>Total</strong></td><td/><td className="text-right"><strong>{totalSavingsRwf.toLocaleString()} RWF</strong></td>
                        <td className="text-center"><strong>100%</strong></td><td className="text-right"><strong>{totalDivPoolRwf.toLocaleString()} RWF</strong></td><td/>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {term?.distributed && <div className="alert alert-success">✅ Dividends for Term #{term.termId?.toString()} distributed!</div>}
                {term&&!term.distributed&&termPct>=100 && <div className="alert alert-warning">⏰ Term ended — click "Distribute Dividends" above.</div>}
                {term&&!term.distributed&&Number(fmtRWF(term.interestCollected))===0 && <div className="alert alert-info">💡 No interest collected yet. Dividends appear after loan repayments.</div>}
              </div>
            </div>
          )}

          {/* Admin */}
          {currentPage === 'admin' && canRegisterMembers && (
            <div className="page-section">
              <h1>Admin Panel</h1>
              <div className="action-card">
                <h2>Register New Member</h2>
                <p className="card-desc">Assign a role to set approval authority.</p>
                <div className="register-form">
                  <div className="input-group"><label>Wallet Address</label><input value={regWallet} onChange={e=>setRegWallet(e.target.value)} placeholder="0x123…"/></div>
                  <div className="input-group"><label>Full Name</label><input value={regName} onChange={e=>setRegName(e.target.value)} placeholder="John Doe"/></div>
                  <div className="input-group"><label>Email</label><input value={regEmail} onChange={e=>setRegEmail(e.target.value)} placeholder="john@example.com"/></div>
                  <div className="input-group"><label>Phone</label><input value={regPhone} onChange={e=>setRegPhone(e.target.value)} placeholder="+250 788 123 456"/></div>
                  <div className="input-group">
                    <label>Role</label>
                    <select value={regRole} onChange={e=>setRegRole(parseInt(e.target.value))}>
                      <option value={0}>Regular Member</option>
                      <option value={1}>President (Can approve loans)</option>
                      <option value={2}>Accountant (Can approve loans)</option>
                      <option value={3}>Chief of Member (Can approve loans)</option>
                    </select>
                  </div>
                </div>
                <button className="btn-full" onClick={handleRegister} disabled={loading||!regWallet||!regName||!regEmail||!regPhone}>
                  {loading?<span className="spinner">⟳</span>:'Register Member'}
                </button>
              </div>

              {pendingReqs.length > 0 && (
                <div className="action-card" style={{marginTop:'1.5rem'}}>
                  <h2>Pending Loan Requests ({pendingReqs.length})</h2>
                  <p className="card-desc">Awaiting leader approvals. Admin can only reject.</p>
                  {pendingReqs.map(r => {
                    const info = allMembers.find(m=>m.address.toLowerCase()===r.borrower?.toLowerCase());
                    return (
                      <div key={r.id} className="request-card">
                        <div className="request-info">
                          <div className="request-borrower">
                            <strong>{info?.name||shortAddr(r.borrower)}</strong>
                            <small>{shortAddr(r.borrower)}</small>
                          </div>
                          <div className="request-amount">{fmtRWFDisplay(r.amount)} RWF</div>
                          <div className="request-date">{new Date(Number(r.requestedAt)*1000).toLocaleString()}</div>
                        </div>
                        <div className="request-actions">
                          <button className="btn-danger" onClick={()=>handleRejectLoan(r.id)} disabled={loading}>✕ Reject</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="info-card" style={{marginTop:'1.5rem'}}>
                <h3>📋 Role Information</h3>
                <ul>
                  <li><strong>President</strong> — Can approve loan requests</li>
                  <li><strong>Accountant</strong> — Can approve loan requests</li>
                  <li><strong>Chief of Member</strong> — Can approve loan requests</li>
                  <li><strong>Regular Member</strong> — No approval authority</li>
                </ul>
                <p className="info-note">Loans require 2 leader approvals. Leaders cannot approve their own loan.</p>
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
          <span>💱 1 ETH = {ETH_RWF_RATE.toLocaleString()} RWF</span>
          <span>👥 {memberCount} Members</span>
        </div>
      </footer>

      <ToastContainer toasts={toasts} />
    </div>
  );
}

function SidebarLink({ href, active, onClick, children }) {
  return (
    <a href={href} className={`sidebar-link ${active?'active':''}`} onClick={e=>{ e.preventDefault(); onClick(); }}>
      {children}
    </a>
  );
}

function ToastContainer({ toasts }) {
  const icons = { success:'✓', error:'✕', info:'ℹ' };
  return (
    <div className="toast-container">
      {toasts.map(t=>(
        <div key={t.id} className={`toast ${t.type}`}>
          <span>{icons[t.type]}</span><span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}