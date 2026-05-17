// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

// ============================================================
//  IkiminaV1 - Upgradeable Community Savings & Lending Contract
// ============================================================
contract IkiminaV1 is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    // ── Constants ──────────────────────────────────────────
    uint256 public constant LOAN_MULTIPLIER = 3;
    uint256 public constant INTEREST_BPS = 500; // 5%
    uint256 public constant LATE_PENALTY_BPS = 200; // 2%
    uint256 public constant DIVIDEND_BPS = 8000; // 80%
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 public constant LOAN_DURATION = 30 days;
    uint256 public constant TERM_DURATION = 180 days;
    uint256 public constant MAX_MEMBERS = 100;
    uint256 public constant MIN_CONTRIBUTION = 0.001 ether;

    // Pool Safety Constants
    uint256 public constant MAX_LOAN_PERCENTAGE = 50;
    uint256 public constant REQUIRED_RESERVE_PERCENTAGE = 30;
    uint256 public constant AUTO_APPROVAL_MAX_PERCENTAGE = 10;
    uint256 public constant NEW_MEMBER_TENURE_DAYS = 30;

    // ── Enums ──────────────────────────────────────────────
    enum LoanStatus {
        None,
        Pending,
        Active,
        Repaid,
        Defaulted
    }
    enum MemberRole {
        Regular,
        President,
        Accountant,
        ChiefOfMember
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
        MemberRole role;
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

    // ── State Variables ────────────────────────────────────
    address public admin;
    address public pendingAdmin;

    uint256 public totalPool;
    uint256 public reservePool;
    uint256 public memberCount;
    uint256 public currentTermId;

    mapping(address => Member) public members;
    mapping(address => Loan) public loans;
    mapping(uint256 => LoanRequest) public loanRequests;
    mapping(uint256 => Term) public terms;

    address[] public memberList;
    uint256 public loanRequestCount;

    uint256 public autoApprovedCount;
    uint256 public manuallyApprovedCount;

    string public version;
    uint256 public lastUpgradeTimestamp;

    // ── Events ─────────────────────────────────────────────
    event MemberRegistered(
        address indexed wallet,
        string name,
        MemberRole role,
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
        bool autoApproved,
        uint256 timestamp
    );
    event LoanAutoApproved(
        address indexed borrower,
        uint256 amount,
        uint256 totalOwed,
        uint256 deadline,
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
    event PenaltyApplied(
        address indexed borrower,
        uint256 penaltyAmount,
        uint256 timestamp
    );
    event RoleUpdated(
        address indexed member,
        MemberRole oldRole,
        MemberRole newRole,
        uint256 timestamp
    );
    event ContractUpgraded(
        address indexed implementation,
        string newVersion,
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

    modifier onlyLeader() {
        MemberRole role = members[msg.sender].role;
        require(
            role == MemberRole.President ||
                role == MemberRole.Accountant ||
                role == MemberRole.ChiefOfMember,
            "Ikimina: not authorized"
        );
        _;
    }

    // ── Initialize (replaces constructor) ─────────────────
    function initialize() public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        admin = msg.sender;

        // Allow this address to add/remove members like the deployer/admin.
        canAddMembers[0x9ba30a835cE6D3714d4026bd62305B1894738245] = true;

        version = "1.0.0";
        lastUpgradeTimestamp = block.timestamp;
        _startNewTerm();
    }

    // Required for UUPS
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    // ════════════════════════════════════════════════════════
    //  MEMBER MANAGEMENT
    // ════════════════════════════════════════════════════════

    function register(
        string calldata _name,
        string calldata _email,
        string calldata _phone,
        address _wallet,
        MemberRole _role
    ) external onlyAdminOrMemberAdder whenNotPaused {
        require(_wallet != address(0), "Ikimina: zero address");
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
            joinedAt: block.timestamp,
            role: _role
        });

        memberList.push(_wallet);
        memberCount++;
        emit MemberRegistered(_wallet, _name, _role, block.timestamp);
    }

    function updateMemberRole(
        address _wallet,
        MemberRole _newRole
    ) external onlyAdmin {
        require(
            members[_wallet].isRegistered,
            "Ikimina: member not registered"
        );
        MemberRole oldRole = members[_wallet].role;
        members[_wallet].role = _newRole;
        emit RoleUpdated(_wallet, oldRole, _newRole, block.timestamp);
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
    //  LOAN WORKFLOW WITH AUTO-APPROVAL
    // ════════════════════════════════════════════════════════

    function requestLoan(
        uint256 _amount
    ) external onlyMember whenNotPaused returns (uint256 requestId) {
        require(_amount > 0, "Ikimina: amount must be > 0");
        require(
            loans[msg.sender].status != LoanStatus.Active &&
                loans[msg.sender].status != LoanStatus.Pending,
            "Ikimina: existing loan"
        );
        require(
            _amount <= members[msg.sender].savings * LOAN_MULTIPLIER,
            "Ikimina: exceeds 3x savings limit"
        );
        require(_amount <= totalPool, "Ikimina: insufficient pool");
        require(
            _amount <= (totalPool * MAX_LOAN_PERCENTAGE) / 100,
            "Ikimina: exceeds pool safety limit"
        );
        require(
            totalPool - _amount >=
                (totalPool * REQUIRED_RESERVE_PERCENTAGE) / 100,
            "Ikimina: violates reserve requirement"
        );

        bool autoApproved = _checkAutoApprovalConditions(_amount);

        if (autoApproved) {
            _executeLoanApproval(msg.sender, _amount);
            autoApprovedCount++;
            emit LoanRequested(0, msg.sender, _amount, true, block.timestamp);
            emit LoanAutoApproved(
                msg.sender,
                _amount,
                _amount + (_amount * INTEREST_BPS) / BPS_DENOMINATOR,
                block.timestamp + LOAN_DURATION,
                block.timestamp
            );
            return 0;
        } else {
            requestId = loanRequestCount++;
            loanRequests[requestId] = LoanRequest({
                borrower: msg.sender,
                amount: _amount,
                requestedAt: block.timestamp,
                approved: false,
                rejected: false
            });
            loans[msg.sender].status = LoanStatus.Pending;
            emit LoanRequested(
                requestId,
                msg.sender,
                _amount,
                false,
                block.timestamp
            );
            return requestId;
        }
    }

    function _checkAutoApprovalConditions(
        uint256 _amount
    ) internal view returns (bool) {
        Member storage member = members[msg.sender];
        if (totalPool < _amount * 2) return false;
        if (member.savings < _amount) return false;
        uint256 maxAutoAmount = (totalPool * AUTO_APPROVAL_MAX_PERCENTAGE) /
            100;
        if (_amount > maxAutoAmount) return false;
        if (block.timestamp < member.joinedAt + NEW_MEMBER_TENURE_DAYS * 1 days)
            return false;
        if (loans[msg.sender].status == LoanStatus.Defaulted) return false;
        return true;
    }

    function _executeLoanApproval(address _borrower, uint256 _amount) internal {
        uint256 interest = (_amount * INTEREST_BPS) / BPS_DENOMINATOR;
        uint256 totalOwed = _amount + interest;
        uint256 deadline = block.timestamp + LOAN_DURATION;

        loans[_borrower] = Loan({
            principal: _amount,
            totalOwed: totalOwed,
            amountRepaid: 0,
            deadline: deadline,
            status: LoanStatus.Active
        });

        totalPool -= _amount;
        emit LoanDisbursed(
            _borrower,
            _amount,
            totalOwed,
            deadline,
            block.timestamp
        );

        (bool sent, ) = payable(_borrower).call{value: _amount}("");
        require(sent, "Ikimina: ETH transfer failed");
    }

    function approveLoan(
        uint256 _requestId
    ) external onlyLeader nonReentrant whenNotPaused {
        LoanRequest storage req = loanRequests[_requestId];
        require(!req.approved && !req.rejected, "Ikimina: already processed");
        require(
            loans[req.borrower].status == LoanStatus.Pending,
            "Ikimina: not pending"
        );
        require(req.amount <= totalPool, "Ikimina: insufficient pool");

        req.approved = true;
        _executeLoanApproval(req.borrower, req.amount);
        manuallyApprovedCount++;
        emit LoanApproved(
            _requestId,
            req.borrower,
            req.amount,
            block.timestamp
        );
    }

    function rejectLoan(uint256 _requestId) external onlyLeader {
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

    function flagDefault(address _borrower) external onlyLeader {
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
        require(block.timestamp >= term.endTime, "Ikimina: term not ended");
        require(!term.distributed, "Ikimina: already distributed");
        require(term.interestCollected > 0, "Ikimina: no interest");
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
        require(amount > 0, "Ikimina: no dividends");
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
    }

    function acceptAdminTransfer() external {
        require(msg.sender == pendingAdmin, "Ikimina: not pending admin");
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }

    function pause() external onlyAdmin {
        _pause();
    }
    function unpause() external onlyAdmin {
        _unpause();
    }

    function emergencyWithdraw(
        address _to,
        uint256 _amount
    ) external onlyAdmin whenPaused {
        require(
            _amount <= address(this).balance,
            "Ikimina: insufficient balance"
        );
        (bool sent, ) = payable(_to).call{value: _amount}("");
        require(sent, "Ikimina: transfer failed");
    }

    function upgradeVersion(string memory _newVersion) external onlyOwner {
        version = _newVersion;
        lastUpgradeTimestamp = block.timestamp;
        emit ContractUpgraded(address(this), _newVersion, block.timestamp);
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
            uint256 joinedAt,
            MemberRole role
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
            m.joinedAt,
            m.role
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

    function getPoolBasedMaxLoan() external view returns (uint256) {
        return (totalPool * MAX_LOAN_PERCENTAGE) / 100;
    }

    function getAvailableLoanCapacity() external view returns (uint256) {
        return (totalPool * (100 - REQUIRED_RESERVE_PERCENTAGE)) / 100;
    }

    function qualifiesForAutoApproval(
        address _member,
        uint256 _amount
    ) external view returns (bool) {
        if (!members[_member].isRegistered || !members[_member].isActive)
            return false;
        if (totalPool < _amount * 2) return false;
        if (members[_member].savings < _amount) return false;
        uint256 maxAutoAmount = (totalPool * AUTO_APPROVAL_MAX_PERCENTAGE) /
            100;
        if (_amount > maxAutoAmount) return false;
        if (
            block.timestamp <
            members[_member].joinedAt + NEW_MEMBER_TENURE_DAYS * 1 days
        ) return false;
        if (loans[_member].status == LoanStatus.Defaulted) return false;
        return true;
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getMemberList() external view returns (address[] memory) {
        return memberList;
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

    function getMemberRole(address _wallet) external view returns (MemberRole) {
        return members[_wallet].role;
    }

    function isLeader(address _wallet) external view returns (bool) {
        MemberRole role = members[_wallet].role;
        return
            role == MemberRole.President ||
            role == MemberRole.Accountant ||
            role == MemberRole.ChiefOfMember;
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
