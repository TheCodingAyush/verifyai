// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title VerifyAIRegistry
/// @notice On-chain provenance registry for AI-generated content.
///         Only SHA-256 hashes and metadata are stored; no files.
contract VerifyAIRegistry is Ownable2Step {
    // ─────────────────────────────────────────────
    // Enums
    // ─────────────────────────────────────────────

    /// @notice Content category
    enum Category {
        AI_GENERATED,
        AI_ASSISTED,
        HUMAN_CREATED
    }

    /// @notice Lifecycle status of a record
    enum Status {
        Active,
        Disputed,
        Revoked
    }

    // ─────────────────────────────────────────────
    // Structs
    // ─────────────────────────────────────────────

    /// @notice A provenance record for one content hash.
    struct Record {
        address creator;
        Category category;
        Status status;
        uint64 timestamp;
        bytes32 promptHash;
        bytes32 parentHash;
        string title;
        string model;
        string modelVersion;
    }

    /// @notice A dispute report filed by any address.
    struct Report {
        bytes32 fileHash;
        address reporter;
        string reason;
        bool resolved;
    }

    // ─────────────────────────────────────────────
    // Custom errors
    // ─────────────────────────────────────────────

    error ZeroHash();
    error AlreadyRegistered(bytes32 fileHash);
    error EmptyTitle();
    error TitleTooLong(uint256 len);
    error HumanCreatedMustHaveNoModel();
    error AIRecordMustHaveModel();
    error ModelNotActive(string modelName);
    error InvalidParent(bytes32 parentHash);
    error ParentRevoked(bytes32 parentHash);
    error NotParentCreator(bytes32 parentHash);
    error EmptyReason();
    error ReasonTooLong(uint256 len);
    error RecordNotFound(bytes32 fileHash);
    error ReportNotFound(uint256 reportId);
    error ReportAlreadyResolved(uint256 reportId);
    error EmptyModelName();
    error ModelAlreadyActive(string modelName);
    error ModelNotFound(string modelName);
    error ModelAlreadyInactive(string modelName);
    error RenounceDisabled();
    error BatchTooLarge(uint256 len);

    // ─────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────

    /// @dev Main registry mapping: fileHash → Record
    mapping(bytes32 => Record) private _records;

    /// @dev Existence flag (avoids zero-value ambiguity)
    mapping(bytes32 => bool) private _exists;

    /// @dev All fileHashes registered by a creator
    mapping(address => bytes32[]) private _creatorRecords;

    /// @dev Child hashes (edits) of a given parent hash
    mapping(bytes32 => bytes32[]) private _children;

    // Aggregate counters
    uint256 private _totalCount;
    uint256[3] private _categoryCount; // indexed by Category enum
    uint256[3] private _statusCount;   // indexed by Status enum

    // Model registry
    string[] private _modelNames;
    mapping(string => bool) private _modelExists;  // ever added
    mapping(string => bool) private _modelActive;
    mapping(string => uint256) private _modelUses;

    // Reports
    Report[] private _reports;

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────

    /// @notice Emitted when a new record is registered.
    event Registered(
        bytes32 indexed fileHash,
        address indexed creator,
        Category category,
        string model
    );

    /// @notice Emitted when the status of a record changes (admin only).
    event StatusChanged(
        bytes32 indexed fileHash,
        Status oldStatus,
        Status newStatus
    );

    /// @notice Emitted when a report is filed.
    event ReportFiled(
        uint256 indexed reportId,
        bytes32 indexed fileHash,
        address indexed reporter
    );

    /// @notice Emitted when a report is resolved (admin only).
    event ReportResolved(uint256 indexed reportId);

    /// @notice Emitted when a model is added or reactivated.
    event ModelAdded(string name);

    /// @notice Emitted when a model is deactivated.
    event ModelDeactivated(string name);

    // ─────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────

    /// @param initialOwner The initial admin / owner of the contract.
    constructor(address initialOwner) Ownable(initialOwner) {
        // Seed the model list
        _addModel("GPT");
        _addModel("Gemini");
        _addModel("Claude");
        _addModel("Stable Diffusion");
        _addModel("Midjourney");
        _addModel("Other");
    }

    // ─────────────────────────────────────────────
    // Public write functions
    // ─────────────────────────────────────────────

    /// @notice Register a new content hash on-chain.
    /// @param fileHash   SHA-256 hash of the content (must be unique and non-zero).
    /// @param title      Human-readable title (1–80 bytes).
    /// @param category   Content category.
    /// @param model      Model name (required for AI categories; must be empty for HUMAN_CREATED).
    /// @param modelVersion Arbitrary version string for the model.
    /// @param promptHash SHA-256 hash of the prompt (zero is allowed).
    /// @param parentHash Hash of the parent record this is an edit of (zero = no parent).
    function register(
        bytes32 fileHash,
        string calldata title,
        Category category,
        string calldata model,
        string calldata modelVersion,
        bytes32 promptHash,
        bytes32 parentHash
    ) external {
        // ── Validation ──────────────────────────────
        if (fileHash == bytes32(0)) revert ZeroHash();
        if (_exists[fileHash]) revert AlreadyRegistered(fileHash);

        uint256 titleBytes = bytes(title).length;
        if (titleBytes == 0) revert EmptyTitle();
        if (titleBytes > 80) revert TitleTooLong(titleBytes);

        bool hasModel = bytes(model).length > 0;

        if (category == Category.HUMAN_CREATED && hasModel) {
            revert HumanCreatedMustHaveNoModel();
        }
        if ((category == Category.AI_GENERATED || category == Category.AI_ASSISTED) && !hasModel) {
            revert AIRecordMustHaveModel();
        }
        if (hasModel && !_modelActive[model]) {
            revert ModelNotActive(model);
        }

        if (parentHash != bytes32(0)) {
            if (!_exists[parentHash]) revert InvalidParent(parentHash);
            Record storage parent = _records[parentHash];
            if (parent.creator != msg.sender) revert NotParentCreator(parentHash);
            if (parent.status == Status.Revoked) revert ParentRevoked(parentHash);
        }

        // ── Write ────────────────────────────────────
        _records[fileHash] = Record({
            creator: msg.sender,
            category: category,
            status: Status.Active,
            timestamp: uint64(block.timestamp),
            promptHash: promptHash,
            parentHash: parentHash,
            title: title,
            model: model,
            modelVersion: modelVersion
        });
        _exists[fileHash] = true;

        _creatorRecords[msg.sender].push(fileHash);

        if (parentHash != bytes32(0)) {
            _children[parentHash].push(fileHash);
        }

        _totalCount++;
        _categoryCount[uint256(category)]++;
        _statusCount[uint256(Status.Active)]++;

        if (hasModel) {
            _modelUses[model]++;
        }

        emit Registered(fileHash, msg.sender, category, model);
    }

    /// @notice File a dispute report against a registered record.
    /// @param fileHash SHA-256 hash of the content being reported.
    /// @param reason   Description of the dispute (1–280 bytes).
    function reportRecord(bytes32 fileHash, string calldata reason) external {
        if (!_exists[fileHash]) revert RecordNotFound(fileHash);

        uint256 reasonBytes = bytes(reason).length;
        if (reasonBytes == 0) revert EmptyReason();
        if (reasonBytes > 280) revert ReasonTooLong(reasonBytes);

        uint256 reportId = _reports.length;
        _reports.push(Report({
            fileHash: fileHash,
            reporter: msg.sender,
            reason: reason,
            resolved: false
        }));

        emit ReportFiled(reportId, fileHash, msg.sender);
    }

    /// @notice Change the status of a record. Admin only.
    /// @dev Admin may only change status, never other creator data.
    function setStatus(bytes32 fileHash, Status status) external onlyOwner {
        if (!_exists[fileHash]) revert RecordNotFound(fileHash);

        Record storage rec = _records[fileHash];
        Status oldStatus = rec.status;

        if (oldStatus == status) return; // no-op

        _statusCount[uint256(oldStatus)]--;
        _statusCount[uint256(status)]++;
        rec.status = status;

        emit StatusChanged(fileHash, oldStatus, status);
    }

    /// @notice Mark a report as resolved. Admin only.
    function resolveReport(uint256 reportId) external onlyOwner {
        if (reportId >= _reports.length) revert ReportNotFound(reportId);
        if (_reports[reportId].resolved) revert ReportAlreadyResolved(reportId);

        _reports[reportId].resolved = true;
        emit ReportResolved(reportId);
    }

    /// @notice Add a new model name (or reactivate an inactive one). Admin only.
    function addModel(string calldata name) external onlyOwner {
        if (bytes(name).length == 0) revert EmptyModelName();
        if (_modelActive[name]) revert ModelAlreadyActive(name);

        if (!_modelExists[name]) {
            _modelNames.push(name);
            _modelExists[name] = true;
        }
        _modelActive[name] = true;

        emit ModelAdded(name);
    }

    /// @notice Deactivate a model, preventing new AI registrations with it. Admin only.
    function deactivateModel(string calldata name) external onlyOwner {
        if (bytes(name).length == 0) revert EmptyModelName();
        if (!_modelExists[name]) revert ModelNotFound(name);
        if (!_modelActive[name]) revert ModelAlreadyInactive(name);

        _modelActive[name] = false;
        emit ModelDeactivated(name);
    }

    /// @notice Renouncing ownership is permanently disabled to protect the admin role.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ─────────────────────────────────────────────
    // View functions
    // ─────────────────────────────────────────────

    /// @notice Get a full record by its file hash.
    function getRecord(bytes32 fileHash) external view returns (Record memory) {
        if (!_exists[fileHash]) revert RecordNotFound(fileHash);
        return _records[fileHash];
    }

    /// @notice Get a batch of records by their file hashes.
    /// @param hashes Array of file hashes (maximum 50).
    function getRecords(bytes32[] calldata hashes) external view returns (Record[] memory) {
        uint256 len = hashes.length;
        if (len > 50) revert BatchTooLarge(len);

        Record[] memory batch = new Record[](len);
        for (uint256 i = 0; i < len; ) {
            bytes32 h = hashes[i];
            if (!_exists[h]) revert RecordNotFound(h);
            batch[i] = _records[h];
            unchecked {
                ++i;
            }
        }
        return batch;
    }

    /// @notice Check whether a file hash has been registered.
    function exists(bytes32 fileHash) external view returns (bool) {
        return _exists[fileHash];
    }

    /// @notice Return all file hashes registered by a given creator.
    function getCreatorRecords(address creator) external view returns (bytes32[] memory) {
        return _creatorRecords[creator];
    }

    /// @notice Return all child (edit) hashes of a given parent.
    function getChildren(bytes32 parentHash) external view returns (bytes32[] memory) {
        return _children[parentHash];
    }

    /// @notice Aggregate statistics.
    /// @return total Total records.
    /// @return aiGenerated Count of AI_GENERATED records.
    /// @return aiAssisted Count of AI_ASSISTED records.
    /// @return humanCreated Count of HUMAN_CREATED records.
    /// @return active Count of Active records.
    /// @return disputed Count of Disputed records.
    /// @return revoked Count of Revoked records.
    function getStats()
        external
        view
        returns (
            uint256 total,
            uint256 aiGenerated,
            uint256 aiAssisted,
            uint256 humanCreated,
            uint256 active,
            uint256 disputed,
            uint256 revoked
        )
    {
        return (
            _totalCount,
            _categoryCount[uint256(Category.AI_GENERATED)],
            _categoryCount[uint256(Category.AI_ASSISTED)],
            _categoryCount[uint256(Category.HUMAN_CREATED)],
            _statusCount[uint256(Status.Active)],
            _statusCount[uint256(Status.Disputed)],
            _statusCount[uint256(Status.Revoked)]
        );
    }

    /// @notice List all model names (active and inactive).
    function getModelNames() external view returns (string[] memory) {
        return _modelNames;
    }

    /// @notice How many times a model has been used.
    function modelUses(string calldata name) external view returns (uint256) {
        return _modelUses[name];
    }

    /// @notice Whether a model is currently active.
    function isModelActive(string calldata name) external view returns (bool) {
        return _modelActive[name];
    }

    /// @notice Total number of reports filed.
    function reportCount() external view returns (uint256) {
        return _reports.length;
    }

    /// @notice Get a report by its ID.
    function getReport(uint256 reportId) external view returns (Report memory) {
        if (reportId >= _reports.length) revert ReportNotFound(reportId);
        return _reports[reportId];
    }

    /// @notice Get a paginated batch of dispute reports.
    /// @param start Starting report index.
    /// @param count Maximum number of reports to return (maximum 50).
    function getReports(uint256 start, uint256 count) external view returns (Report[] memory) {
        if (count > 50) revert BatchTooLarge(count);

        uint256 total = _reports.length;
        if (start >= total || count == 0) {
            return new Report[](0);
        }

        uint256 end = start + count;
        if (end > total) {
            end = total;
        }

        uint256 size = end - start;
        Report[] memory batch = new Report[](size);
        for (uint256 i = 0; i < size; ) {
            batch[i] = _reports[start + i];
            unchecked {
                ++i;
            }
        }
        return batch;
    }

    // ─────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────

    function _addModel(string memory name) internal {
        _modelNames.push(name);
        _modelExists[name] = true;
        _modelActive[name] = true;
    }
}
