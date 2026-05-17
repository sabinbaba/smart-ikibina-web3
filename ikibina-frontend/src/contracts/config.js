// export const CONTRACT_ADDRESS = "0x504a63D2d571A3751B5d785f992f43Dcfe11aD3C";

// export const ABI = [
//   // ── Member Management ──
// "function register(string calldata _name, string calldata _email, string calldata _phone, address _wallet) external",
//   "function removeMember(address _wallet) external",

//   // ── Savings ──
//   "function contribute() external payable",
//   "function withdrawSavings(uint256 _amount) external",

//   // ── Loan Workflow ──
//   "function requestLoan(uint256 _amount) external returns (uint256 requestId)",
//   "function approveLoan(uint256 _requestId) external",
//   "function rejectLoan(uint256 _requestId) external",
//   "function repayLoan() external payable",
//   "function flagDefault(address _borrower) external",

//   // ── Dividends ──
//   "function distributeDividends() external",
//   "function claimDividends() external",

//   // ── Admin ──
//   "function initiateAdminTransfer(address _newAdmin) external",
//   "function acceptAdminTransfer() external",
//   "function pause() external",
//   "function unpause() external",

//   // ── View Functions ──
//   "function getMember(address _wallet) external view returns (string memory name, string memory email, string memory phone, bool isRegistered, bool isActive, uint256 savings, uint256 pendingDividends, uint256 joinedAt)",
//   "function getLoan(address _wallet) external view returns (uint256 principal, uint256 totalOwed, uint256 amountRepaid, uint256 remainingOwed, uint256 deadline, uint8 status)",
//   "function getLoanRequest(uint256 _requestId) external view returns (address borrower, uint256 amount, uint256 requestedAt, bool approved, bool rejected)",
//   "function getCurrentTerm() external view returns (uint256 termId, uint256 startTime, uint256 endTime, uint256 interestCollected, bool distributed)",
//   "function maxLoanAmount(address _wallet) external view returns (uint256)",
//   "function contractBalance() external view returns (uint256)",
//   "function totalPool() external view returns (uint256)",
//   "function reservePool() external view returns (uint256)",
//   "function memberCount() external view returns (uint256)",
//   "function admin() external view returns (address)",
//   "function paused() external view returns (bool)",
//   "function getMemberList() external view returns (address[])",
//   "function loanRequestCount() external view returns (uint256)",

//   // ── Events ──
//   "event MemberRegistered(address indexed wallet, string name, uint256 timestamp)",
//   "event ContributionMade(address indexed member, uint256 amount, uint256 newSavings, uint256 newTotalPool, uint256 timestamp)",
//   "event WithdrawalMade(address indexed member, uint256 amount, uint256 remainingSavings, uint256 timestamp)",
//   "event LoanRequested(uint256 indexed requestId, address indexed borrower, uint256 amount, uint256 timestamp)",
//   "event LoanApproved(uint256 indexed requestId, address indexed borrower, uint256 amount, uint256 timestamp)",
//   "event LoanRejected(uint256 indexed requestId, address indexed borrower, uint256 timestamp)",
//   "event LoanDisbursed(address indexed borrower, uint256 principal, uint256 totalOwed, uint256 deadline, uint256 timestamp)",
//   "event LoanRepaid(address indexed borrower, uint256 amountPaid, uint256 remainingOwed, bool loanClosed, uint256 timestamp)",
//   "event LoanDefaulted(address indexed borrower, uint256 amountOwed, uint256 deadline, uint256 timestamp)",
//   "event DividendDistributed(uint256 indexed termId, uint256 totalDividend, uint256 memberShare, uint256 timestamp)",
//   "event DividendClaimed(address indexed member, uint256 amount, uint256 timestamp)",
//   "event TermStarted(uint256 indexed termId, uint256 startTime, uint256 endTime)",
//   "event PenaltyApplied(address indexed borrower, uint256 penaltyAmount, uint256 timestamp)"
// ];

// // LoanStatus enum mapping
// export const LOAN_STATUS = {
//   0: "None",
//   1: "Pending",
//   2: "Active",
//   3: "Repaid",
//   4: "Defaulted"
// };



// contracts/config.js

// ── NEW UPGRADEABLE PROXY ADDRESS (IkiminaV1) ──
export const CONTRACT_ADDRESS = "0xc126A871140411e7ED903f31969cE799B66e4396";

// RWF is the savings currency shown in UI.
// ETH is used ONLY to pay gas fees on-chain.
export const ETH_GAS_PER_CONTRIBUTE = "0.000001"; // ~0.000001 ETH per save tx (gas only)
export const RWF_EXCHANGE_RATE = 8500; // 1 ETH ≈ 8,500,000 RWF (fixed rate for display)

// Member Roles
export const MEMBER_ROLES = {
  0: "Regular Member",
  1: "President",
  2: "Accountant",
  3: "Chief of Member"
};

// Fake Mobile Money providers — NO real API calls
export const MOMO_PROVIDERS = [
  { id: "mtn",    name: "MTN Mobile Money", color: "#FFC107", prefix: "078" },
  { id: "airtel", name: "Airtel Money",     color: "#FF3D00", prefix: "073" },
  { id: "equity", name: "Equity Bank",      color: "#1565C0", prefix: "076" },
];

// ── UPDATED ABI FOR IKIMINAV1 (Upgradeable with Roles) ──
export const ABI = [
  // Member Management
  "function register(string calldata _name, string calldata _email, string calldata _phone, address _wallet, uint8 _role) external",
  "function updateMemberRole(address _wallet, uint8 _newRole) external",
  "function removeMember(address _wallet) external",
  
  // Savings
  "function contribute() external payable",
  "function withdrawSavings(uint256 _amount) external",
  
  // Loan Workflow
  "function requestLoan(uint256 _amount) external returns (uint256 requestId)",
  "function approveLoan(uint256 _requestId) external",
  "function rejectLoan(uint256 _requestId) external",
  "function repayLoan() external payable",
  "function flagDefault(address _borrower) external",
  
  // Dividends
  "function distributeDividends() external",
  "function claimDividends() external",
  
  // Admin
  "function initiateAdminTransfer(address _newAdmin) external",
  "function acceptAdminTransfer() external",
  "function pause() external",
  "function unpause() external",
  "function emergencyWithdraw(address _to, uint256 _amount) external",
  "function upgradeVersion(string memory _newVersion) external",
  
  // View Functions - Member
  "function getMember(address _wallet) external view returns (string memory name, string memory email, string memory phone, bool isRegistered, bool isActive, uint256 savings, uint256 pendingDividends, uint256 joinedAt, uint8 role)",
  "function getMemberRole(address _wallet) external view returns (uint8)",
  "function isLeader(address _wallet) external view returns (bool)",
  "function getMemberList() external view returns (address[])",
  
  // View Functions - Loan
  "function getLoan(address _wallet) external view returns (uint256 principal, uint256 totalOwed, uint256 amountRepaid, uint256 remainingOwed, uint256 deadline, uint8 status)",
  "function getLoanRequest(uint256 _requestId) external view returns (address borrower, uint256 amount, uint256 requestedAt, bool approved, bool rejected)",
  "function loanRequestCount() external view returns (uint256)",
  "function maxLoanAmount(address _wallet) external view returns (uint256)",
  
  // View Functions - Pool & Terms
  "function getCurrentTerm() external view returns (uint256 termId, uint256 startTime, uint256 endTime, uint256 interestCollected, bool distributed)",
  "function totalPool() external view returns (uint256)",
  "function reservePool() external view returns (uint256)",
  "function memberCount() external view returns (uint256)",
  "function contractBalance() external view returns (uint256)",
  "function admin() external view returns (address)",
  
  // Safety Limits
  "function getPoolBasedMaxLoan() external view returns (uint256)",
  "function getAvailableLoanCapacity() external view returns (uint256)",
  "function qualifiesForAutoApproval(address _member, uint256 _amount) external view returns (bool)",
  
  // Constants
  "function LOAN_MULTIPLIER() external view returns (uint256)",
  "function INTEREST_BPS() external view returns (uint256)",
  "function LOAN_DURATION() external view returns (uint256)",
  "function MIN_CONTRIBUTION() external view returns (uint256)",
  
  // Version
  "function version() external view returns (string memory)",
  "function lastUpgradeTimestamp() external view returns (uint256)"
];

export const LOAN_STATUS = {
  0: "None",
  1: "Pending",
  2: "Active",
  3: "Repaid",
  4: "Defaulted"
};

// Pool safety constants (matching smart contract)
export const POOL_SAFETY = {
  MAX_LOAN_PERCENTAGE: 50,      // Max 50% of pool per loan
  REQUIRED_RESERVE_PERCENTAGE: 30, // Keep 30% reserve
  AUTO_APPROVAL_MAX_PERCENTAGE: 10, // Auto-approve up to 10% of pool
  NEW_MEMBER_TENURE_DAYS: 30    // 30 days tenure required for auto-approval
};