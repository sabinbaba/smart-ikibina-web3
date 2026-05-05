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




export const CONTRACT_ADDRESS = "0x6B556d24647a74880302E0BE8036bA3DDBF77c74";

// RWF is the savings currency shown in UI.
// ETH is used ONLY to pay gas fees on-chain.
// Each "contribute" tx sends a negligible fixed ETH amount just to trigger the contract.
export const ETH_GAS_PER_CONTRIBUTE = "0.000001"; // ~0.000001 ETH per save tx (gas only)
export const RWF_EXCHANGE_RATE       = 1300;       // 1 USD ≈ 1300 RWF (display only)

// Fake Mobile Money providers — NO real API calls
export const MOMO_PROVIDERS = [
  { id: "mtn",    name: "MTN Mobile Money", color: "#FFC107", prefix: "078" },
  { id: "airtel", name: "Airtel Money",     color: "#FF3D00", prefix: "073" },
  { id: "equity", name: "Equity Bank",      color: "#1565C0", prefix: "076" },
];

export const ABI = [
  "function register(string calldata _name, string calldata _email, string calldata _phone, address _wallet) external",
  "function removeMember(address _wallet) external",
  "function contribute() external payable",
  "function withdrawSavings(uint256 _amount) external",
  "function requestLoan(uint256 _amount) external returns (uint256 requestId)",
  "function approveLoan(uint256 _requestId) external",
  "function rejectLoan(uint256 _requestId) external",
  "function repayLoan() external payable",
  "function flagDefault(address _borrower) external",
  "function distributeDividends() external",
  "function claimDividends() external",
  "function initiateAdminTransfer(address _newAdmin) external",
  "function acceptAdminTransfer() external",
  "function pause() external",
  "function unpause() external",
  "function getMember(address _wallet) external view returns (string memory name, string memory email, string memory phone, bool isRegistered, bool isActive, uint256 savings, uint256 pendingDividends, uint256 joinedAt)",
  "function getLoan(address _wallet) external view returns (uint256 principal, uint256 totalOwed, uint256 amountRepaid, uint256 remainingOwed, uint256 deadline, uint8 status)",
  "function getLoanRequest(uint256 _requestId) external view returns (address borrower, uint256 amount, uint256 requestedAt, bool approved, bool rejected)",
  "function getCurrentTerm() external view returns (uint256 termId, uint256 startTime, uint256 endTime, uint256 interestCollected, bool distributed)",
  "function contractBalance() external view returns (uint256)",
  "function totalPool() external view returns (uint256)",
  "function reservePool() external view returns (uint256)",
  "function memberCount() external view returns (uint256)",
  "function admin() external view returns (address)",
  "function getMemberList() external view returns (address[])",
  "function loanRequestCount() external view returns (uint256)"
];

export const LOAN_STATUS = {
  0: "None", 1: "Pending", 2: "Active", 3: "Repaid", 4: "Defaulted"
};