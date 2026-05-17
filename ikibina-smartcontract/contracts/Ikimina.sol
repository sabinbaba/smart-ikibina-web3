// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================
//  ReentrancyGuard
// ============================================================
abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;
    constructor() {
        _status = _NOT_ENTERED;
    }
    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

// ============================================================
//  Pausable
// ============================================================
abstract contract Pausable {
    bool private _paused;
    event Paused(address account);
    event Unpaused(address account);
    modifier whenNotPaused() {
        require(!_paused, "Pausable: paused");
        _;
    }
    modifier whenPaused() {
        require(_paused, "Pausable: not paused");
        _;
    }
    function paused() public view returns (bool) {
        return _paused;
    }
    function _pause() internal {
        _paused = true;
        emit Paused(msg.sender);
    }
    function _unpause() internal {
        _paused = false;
        emit Unpaused(msg.sender);
    }
}

// ============================================================
//  Ikimina – Modern Community Savings & Lending Contract
// ============================================================
contract Ikimina is ReentrancyGuard, Pausable {
    // ── Constants ──────────────────────────────────────────
    uint256 public constant LOAN_MULTIPLIER = 3;
    uint256 public constant INTEREST_BPS = 500; // 5%
    uint256 public constant LATE_PENALTY_BPS = 200; // 2% extra if overdue
    uint256 public constant DIVIDEND_BPS = 8000; // 80% of interest → members
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 public constant LOAN_DURATION = 30 days;
    uint256 public constant TERM_DURATION = 180 days; // 6-month savings term
    uint256 public constant MAX_MEMBERS = 100;
    uint256 public constant MIN_CONTRIBUTION = 0.001 ether;

    // ── Enums ──────────────────────────────────────────────
    enum LoanStatus {
        None,
        Pending,
        Active,
        Repaid,
        Defaulted
    }

    // ── Structs ────────────────────────────────────────────
    struct Member {
        string name;
        string email;
        string phone;
        address wallet;
        bool isRegistered;
        bool isActive;
        uint256 savings;
        uint256 pendingDividends;
        uint256 joinedAt;
    }

    struct Loan {
        uint256 principal;
        uint256 totalOwed;
        uint256 amountRepaid;
        uint256 deadline;
        LoanStatus status;
    }

    struct LoanRequest {
        address borrower;
        uint256 amount;
        uint256 requestedAt;
        bool approved;
        bool rejected;
    }

    struct Term {
        uint256 startTime;
        uint256 endTime;
        uint256 interestCollected;
        bool distributed;
    }

    // ── State ──────────────────────────────────────────────
    address public admin;
    address public pendingAdmin;

    uint256 public totalPool;
    uint256 public reservePool;
    uint256 public memberCount;
    uint256 public currentTermId;

    mapping(address => Member) private members;
    mapping(address => Loan) private loans;
    mapping(uint256 => LoanRequest) public loanRequests;
    mapping(uint256 => Term) public terms;

    address[] private memberList;
    uint256 public loanRequestCount;

    // ── Events ─────────────────────────────────────────────
    event MemberRegistered(
        address indexed wallet,
        string name,
        uint256 timestamp
    );
    event MemberRemoved(address indexed wallet, uint256 timestamp);
    event ContributionMade(
        address indexed member,
        uint256 amount,
        uint256 newSavings,
        uint256 newTotalPool,
        uint256 timestamp
    );
    event WithdrawalMade(
        address indexed member,
        uint256 amount,
        uint256 remainingSavings,
        uint256 timestamp
    );
    event LoanRequested(
        uint256 indexed requestId,
        address indexed borrower,
        uint256 amount,
        uint256 timestamp
    );
    event LoanApproved(
        uint256 indexed requestId,
        address indexed borrower,
        uint256 amount,
        uint256 timestamp
    );
    event LoanRejected(
        uint256 indexed requestId,
        address indexed borrower,
        uint256 timestamp
    );
    event LoanDisbursed(
        address indexed borrower,
        uint256 principal,
        uint256 totalOwed,
        uint256 deadline,
        uint256 timestamp
    );
    event LoanRepaid(
        address indexed borrower,
        uint256 amountPaid,
        uint256 remainingOwed,
        bool loanClosed,
        uint256 timestamp
    );
    event LoanDefaulted(
        address indexed borrower,
        uint256 amountOwed,
        uint256 deadline,
        uint256 timestamp
    );
    event DividendDistributed(
        uint256 indexed termId,
        uint256 totalDividend,
        uint256 memberShare,
        uint256 timestamp
    );
    event DividendClaimed(
        address indexed member,
        uint256 amount,
        uint256 timestamp
    );
    event TermStarted(
        uint256 indexed termId,
        uint256 startTime,
        uint256 endTime
    );
    event AdminTransferInitiated(
        address indexed currentAdmin,
        address indexed pendingAdmin
    );
    event AdminTransferCompleted(
        address indexed oldAdmin,
        address indexed newAdmin
    );
    event PenaltyApplied(
        address indexed borrower,
        uint256 penaltyAmount,
        uint256 timestamp
    );

    // ── Modifiers ──────────────────────────────────────────
    mapping(address => bool) public canAddMembers;

    modifier onlyAdminOrMemberAdder() {
        require(
            msg.sender == admin || canAddMembers[msg.sender],
            "Ikimina: caller is not admin"
        );
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Ikimina: caller is not admin");
        _;
    }

    modifier onlyMember() {
        require(
            members[msg.sender].isRegistered && members[msg.sender].isActive,
            "Ikimina: not an active member"
        );
        _;
    }

    // ── Constructor ────────────────────────────────────────

    // ════════════════════════════════════════════════════════
    //  MEMBER MANAGEMENT
    // ════════════════════════════════════════════════════════

    address public memberAdder; // optional single address allowed to add members
    address public constant DEFAULT_MEMBER_ADDER =
        0x9ba30a835cE6D3714d4026bd62305B1894738245;

    constructor() {
        admin = msg.sender;
        canAddMembers[DEFAULT_MEMBER_ADDER] = true;
        _startNewTerm();
    }

    function setMemberAdder(address _adder) external {
        require(msg.sender == admin, "Ikimina: caller is not admin");
        memberAdder = _adder;
        canAddMembers[_adder] = true;
    }

    function register(
        string calldata _name,
        string calldata _email,
        string calldata _phone,
        address _wallet
    ) external onlyAdminOrMemberAdder whenNotPaused {
        require(_wallet != address(0), "Ikimina: zero wallet address");
        require(!members[_wallet].isRegistered, "Ikimina: already registered");
        require(memberCount < MAX_MEMBERS, "Ikimina: group is full");
        require(bytes(_name).length > 0, "Ikimina: name required");
        require(bytes(_email).length > 0, "Ikimina: email required");
        require(bytes(_phone).length > 0, "Ikimina: phone required");

        members[_wallet] = Member({
            name: _name,
            email: _email,
            phone: _phone,
            wallet: _wallet,
            isRegistered: true,
            isActive: true,
            savings: 0,
            pendingDividends: 0,
            joinedAt: block.timestamp
        });

        memberList.push(_wallet);
        memberCount++;
        emit MemberRegistered(_wallet, _name, block.timestamp);
    }

    function removeMember(address _wallet) external onlyAdminOrMemberAdder {
        require(
            members[_wallet].isRegistered && members[_wallet].isActive,
            "Ikimina: not an active member"
        );
        require(
            loans[_wallet].status != LoanStatus.Active &&
                loans[_wallet].status != LoanStatus.Pending,
            "Ikimina: member has active/pending loan"
        );

        members[_wallet].isActive = false;
        memberCount--;
        emit MemberRemoved(_wallet, block.timestamp);
    }

    // ════════════════════════════════════════════════════════
    //  SAVINGS
    // ════════════════════════════════════════════════════════

    function contribute()
        external
        payable
        onlyMember
        nonReentrant
        whenNotPaused
    {
        require(
            msg.value >= MIN_CONTRIBUTION,
            "Ikimina: below minimum contribution"
        );
        members[msg.sender].savings += msg.value;
        totalPool += msg.value;
        emit ContributionMade(
            msg.sender,
            msg.value,
            members[msg.sender].savings,
            totalPool,
            block.timestamp
        );
    }

    function withdrawSavings(
        uint256 _amount
    ) external onlyMember nonReentrant whenNotPaused {
        require(_amount > 0, "Ikimina: amount must be > 0");
        require(
            loans[msg.sender].status != LoanStatus.Active,
            "Ikimina: repay active loan first"
        );
        require(
            members[msg.sender].savings >= _amount,
            "Ikimina: insufficient savings"
        );
        require(totalPool >= _amount, "Ikimina: insufficient pool liquidity");

        members[msg.sender].savings -= _amount;
        totalPool -= _amount;
        emit WithdrawalMade(
            msg.sender,
            _amount,
            members[msg.sender].savings,
            block.timestamp
        );

        (bool sent, ) = payable(msg.sender).call{value: _amount}("");
        require(sent, "Ikimina: ETH transfer failed");
    }

    // ════════════════════════════════════════════════════════
    //  LOAN WORKFLOW
    // ════════════════════════════════════════════════════════

    function requestLoan(
        uint256 _amount
    ) external onlyMember whenNotPaused returns (uint256 requestId) {
        require(_amount > 0, "Ikimina: amount must be > 0");
        require(
            loans[msg.sender].status != LoanStatus.Active &&
                loans[msg.sender].status != LoanStatus.Pending,
            "Ikimina: existing loan pending/active"
        );
        require(
            _amount <= members[msg.sender].savings * LOAN_MULTIPLIER,
            "Ikimina: exceeds 3x savings limit"
        );
        require(_amount <= totalPool, "Ikimina: insufficient pool liquidity");

        requestId = loanRequestCount++;
        loanRequests[requestId] = LoanRequest({
            borrower: msg.sender,
            amount: _amount,
            requestedAt: block.timestamp,
            approved: false,
            rejected: false
        });

        loans[msg.sender].status = LoanStatus.Pending;
        emit LoanRequested(requestId, msg.sender, _amount, block.timestamp);
    }

    function approveLoan(
        uint256 _requestId
    ) external onlyAdmin nonReentrant whenNotPaused {
        LoanRequest storage req = loanRequests[_requestId];
        require(!req.approved && !req.rejected, "Ikimina: already processed");
        require(
            loans[req.borrower].status == LoanStatus.Pending,
            "Ikimina: not pending"
        );
        require(req.amount <= totalPool, "Ikimina: insufficient pool");

        req.approved = true;

        uint256 interest = (req.amount * INTEREST_BPS) / BPS_DENOMINATOR;
        uint256 totalOwed = req.amount + interest;
        uint256 deadline = block.timestamp + LOAN_DURATION;

        loans[req.borrower] = Loan({
            principal: req.amount,
            totalOwed: totalOwed,
            amountRepaid: 0,
            deadline: deadline,
            status: LoanStatus.Active
        });

        totalPool -= req.amount;

        emit LoanApproved(
            _requestId,
            req.borrower,
            req.amount,
            block.timestamp
        );
        emit LoanDisbursed(
            req.borrower,
            req.amount,
            totalOwed,
            deadline,
            block.timestamp
        );

        (bool sent, ) = payable(req.borrower).call{value: req.amount}("");
        require(sent, "Ikimina: ETH transfer failed");
    }

    function rejectLoan(uint256 _requestId) external onlyAdmin {
        LoanRequest storage req = loanRequests[_requestId];
        require(!req.approved && !req.rejected, "Ikimina: already processed");

        req.rejected = true;
        loans[req.borrower].status = LoanStatus.None;
        emit LoanRejected(_requestId, req.borrower, block.timestamp);
    }

    function repayLoan()
        external
        payable
        onlyMember
        nonReentrant
        whenNotPaused
    {
        require(msg.value > 0, "Ikimina: repayment must be > 0");
        Loan storage loan = loans[msg.sender];
        require(loan.status == LoanStatus.Active, "Ikimina: no active loan");

        uint256 remaining = loan.totalOwed - loan.amountRepaid;
        require(remaining > 0, "Ikimina: loan already settled");

        uint256 payment = msg.value > remaining ? remaining : msg.value;
        uint256 refund = msg.value - payment;

        loan.amountRepaid += payment;
        totalPool += payment;

        // Track interest portion for dividends
        uint256 interestPortion = (payment *
            (loan.totalOwed - loan.principal)) / loan.totalOwed;
        terms[currentTermId].interestCollected += interestPortion;

        bool loanClosed = (loan.amountRepaid >= loan.totalOwed);
        if (loanClosed) loan.status = LoanStatus.Repaid;

        emit LoanRepaid(
            msg.sender,
            payment,
            loan.totalOwed - loan.amountRepaid,
            loanClosed,
            block.timestamp
        );

        if (refund > 0) {
            (bool sent, ) = payable(msg.sender).call{value: refund}("");
            require(sent, "Ikimina: refund failed");
        }
    }

    function flagDefault(address _borrower) external onlyAdmin {
        Loan storage loan = loans[_borrower];
        require(loan.status == LoanStatus.Active, "Ikimina: no active loan");
        require(block.timestamp > loan.deadline, "Ikimina: loan not overdue");

        uint256 amountOwed = loan.totalOwed - loan.amountRepaid;
        require(amountOwed > 0, "Ikimina: already settled");

        uint256 penalty = (amountOwed * LATE_PENALTY_BPS) / BPS_DENOMINATOR;
        loan.totalOwed += penalty;
        loan.status = LoanStatus.Defaulted;

        emit PenaltyApplied(_borrower, penalty, block.timestamp);
        emit LoanDefaulted(
            _borrower,
            amountOwed + penalty,
            loan.deadline,
            block.timestamp
        );
    }

    // ════════════════════════════════════════════════════════
    //  TERM & DIVIDEND MANAGEMENT
    // ════════════════════════════════════════════════════════

    function distributeDividends() external nonReentrant {
        Term storage term = terms[currentTermId];
        require(block.timestamp >= term.endTime, "Ikimina: term not ended yet");
        require(!term.distributed, "Ikimina: already distributed");
        require(
            term.interestCollected > 0,
            "Ikimina: no interest to distribute"
        );
        require(memberCount > 0, "Ikimina: no members");

        term.distributed = true;

        uint256 dividendPool = (term.interestCollected * DIVIDEND_BPS) /
            BPS_DENOMINATOR;
        reservePool += term.interestCollected - dividendPool;

        uint256 totalSavingsSnapshot = _totalMemberSavings();

        for (uint256 i = 0; i < memberList.length; i++) {
            address wallet = memberList[i];
            if (!members[wallet].isActive) continue;

            uint256 share = totalSavingsSnapshot > 0
                ? (dividendPool * members[wallet].savings) /
                    totalSavingsSnapshot
                : dividendPool / memberCount;

            members[wallet].pendingDividends += share;
        }

        emit DividendDistributed(
            currentTermId,
            dividendPool,
            dividendPool / memberCount,
            block.timestamp
        );

        currentTermId++;
        _startNewTerm();
    }

    function claimDividends() external onlyMember nonReentrant whenNotPaused {
        uint256 amount = members[msg.sender].pendingDividends;
        require(amount > 0, "Ikimina: no dividends to claim");
        require(totalPool >= amount, "Ikimina: pool insufficient");

        members[msg.sender].pendingDividends = 0;
        totalPool -= amount;

        emit DividendClaimed(msg.sender, amount, block.timestamp);

        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "Ikimina: ETH transfer failed");
    }

    // ════════════════════════════════════════════════════════
    //  ADMIN FUNCTIONS
    // ════════════════════════════════════════════════════════

    function initiateAdminTransfer(address _newAdmin) external onlyAdmin {
        require(_newAdmin != address(0), "Ikimina: zero address");
        pendingAdmin = _newAdmin;
        emit AdminTransferInitiated(admin, _newAdmin);
    }

    function acceptAdminTransfer() external {
        require(msg.sender == pendingAdmin, "Ikimina: not pending admin");
        emit AdminTransferCompleted(admin, pendingAdmin);
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }

    function pause() external onlyAdmin {
        _pause();
    }
    function unpause() external onlyAdmin {
        _unpause();
    }

    // ════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ════════════════════════════════════════════════════════

    function getMember(
        address _wallet
    )
        external
        view
        returns (
            string memory name,
            string memory email,
            string memory phone,
            bool isRegistered,
            bool isActive,
            uint256 savings,
            uint256 pendingDividends,
            uint256 joinedAt
        )
    {
        Member storage m = members[_wallet];
        return (
            m.name,
            m.email,
            m.phone,
            m.isRegistered,
            m.isActive,
            m.savings,
            m.pendingDividends,
            m.joinedAt
        );
    }

    function getLoan(
        address _wallet
    )
        external
        view
        returns (
            uint256 principal,
            uint256 totalOwed,
            uint256 amountRepaid,
            uint256 remainingOwed,
            uint256 deadline,
            LoanStatus status
        )
    {
        Loan storage l = loans[_wallet];
        uint256 remaining = l.totalOwed > l.amountRepaid
            ? l.totalOwed - l.amountRepaid
            : 0;
        return (
            l.principal,
            l.totalOwed,
            l.amountRepaid,
            remaining,
            l.deadline,
            l.status
        );
    }

    function getLoanRequest(
        uint256 _requestId
    )
        external
        view
        returns (
            address borrower,
            uint256 amount,
            uint256 requestedAt,
            bool approved,
            bool rejected
        )
    {
        LoanRequest storage r = loanRequests[_requestId];
        return (r.borrower, r.amount, r.requestedAt, r.approved, r.rejected);
    }

    function getCurrentTerm()
        external
        view
        returns (
            uint256 termId,
            uint256 startTime,
            uint256 endTime,
            uint256 interestCollected,
            bool distributed
        )
    {
        Term storage t = terms[currentTermId];
        return (
            currentTermId,
            t.startTime,
            t.endTime,
            t.interestCollected,
            t.distributed
        );
    }

    function maxLoanAmount(address _wallet) external view returns (uint256) {
        if (!members[_wallet].isRegistered || !members[_wallet].isActive)
            return 0;
        return members[_wallet].savings * LOAN_MULTIPLIER;
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }
    function getMemberList() external view returns (address[] memory) {
        return memberList;
    }

    // ════════════════════════════════════════════════════════
    //  INTERNAL HELPERS
    // ════════════════════════════════════════════════════════

    function _startNewTerm() internal {
        uint256 start = block.timestamp;
        uint256 end = start + TERM_DURATION;
        terms[currentTermId] = Term({
            startTime: start,
            endTime: end,
            interestCollected: 0,
            distributed: false
        });
        emit TermStarted(currentTermId, start, end);
    }

    function _totalMemberSavings() internal view returns (uint256 total) {
        for (uint256 i = 0; i < memberList.length; i++) {
            if (members[memberList[i]].isActive)
                total += members[memberList[i]].savings;
        }
    }

    receive() external payable {
        revert("Ikimina: use contribute()");
    }
    fallback() external payable {
        revert("Ikimina: unknown function");
    }
}
