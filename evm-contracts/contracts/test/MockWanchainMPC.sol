// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../interfaces/IWanchainMPC.sol";

/**
 * @title MockWanchainMPC
 * @dev Test double for IWanchainMPC. All behaviour is configurable so tests can
 *      exercise different code paths in WmbGateway without deploying a real MPC
 *      oracle network.
 */
contract MockWanchainMPC is IWanchainMPC {
    // ── Configurable state ──────────────────────────────────────────────────

    uint256 public chainId;
    bool public verifyResult;

    // Partners returned by getPartners()
    address public tokenManager;
    address public smgAdminProxy;
    address public smgFeeProxy;
    address public quota;
    address public sigVerifier;

    // Storeman group config
    bytes32 public smgGroupId;
    uint8   public smgStatus;     // 5 = GroupStatus.ready
    uint    public smgDeposit;
    uint    public smgChain1;
    uint    public smgChain2;
    uint    public smgCurve1;
    uint    public smgCurve2;
    bytes   public smgGpk1;
    bytes   public smgGpk2;
    uint    public smgStartTime;
    uint    public smgEndTime;

    // ── Constructor ─────────────────────────────────────────────────────────

    constructor(
        uint256 _chainId,
        address _smgAdminProxy,
        address _sigVerifier
    ) {
        chainId      = _chainId;
        verifyResult = true;

        // Partners
        tokenManager  = address(0x1111);
        smgAdminProxy = _smgAdminProxy;
        smgFeeProxy   = address(0x3333);
        quota         = address(0x4444);
        sigVerifier   = _sigVerifier;

        // Default storeman group: status=ready(5), timestamps spanning a wide window
        smgStatus    = 5; // GroupStatus.ready
        smgDeposit   = 0;
        smgChain1    = _chainId;
        smgChain2    = 0;
        smgCurve1    = 1;
        smgCurve2    = 0;
        // gpk1 must be at least 64 bytes so _bytesToBytes32 doesn't OOB
        smgGpk1      = new bytes(64);
        smgGpk2      = new bytes(64);
        smgStartTime = 0;
        smgEndTime   = type(uint256).max;
    }

    // ── Setters ─────────────────────────────────────────────────────────────

    function setChainId(uint256 _chainId) external {
        chainId = _chainId;
    }

    function setVerifyResult(bool _result) external {
        verifyResult = _result;
    }

    function setSmgStatus(uint8 _status) external {
        smgStatus = _status;
    }

    function setSmgTimes(uint _startTime, uint _endTime) external {
        smgStartTime = _startTime;
        smgEndTime   = _endTime;
    }

    // ── IWanchainMPC ────────────────────────────────────────────────────────

    function currentChainID() external view override returns (uint256) {
        return chainId;
    }

    function getPartners() external view override returns (
        address _tokenManager,
        address _smgAdminProxy,
        address _smgFeeProxy,
        address _quota,
        address _sigVerifier
    ) {
        return (tokenManager, smgAdminProxy, smgFeeProxy, quota, sigVerifier);
    }

    function getStoremanGroupConfig(bytes32 /*id*/) external view override returns (
        bytes32 groupId,
        uint8   status,
        uint    deposit,
        uint    chain1,
        uint    chain2,
        uint    curve1,
        uint    curve2,
        bytes memory gpk1,
        bytes memory gpk2,
        uint    startTime,
        uint    endTime
    ) {
        return (
            smgGroupId,
            smgStatus,
            smgDeposit,
            smgChain1,
            smgChain2,
            smgCurve1,
            smgCurve2,
            smgGpk1,
            smgGpk2,
            smgStartTime,
            smgEndTime
        );
    }

    function verify(
        uint    /*curveId*/,
        bytes32 /*signature*/,
        bytes32 /*groupKeyX*/,
        bytes32 /*groupKeyY*/,
        bytes32 /*randomPointX*/,
        bytes32 /*randomPointY*/,
        bytes32 /*message*/
    ) external view override returns (bool) {
        return verifyResult;
    }
}
