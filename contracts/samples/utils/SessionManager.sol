// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

abstract contract SessionManager {
    event SessionCreated(address indexed sessionUser, uint256 startFrom, uint256 validUntil, uint256 totalAmount);
    event SessionRemoved(
        address indexed sessionUser,
        uint256 startFrom,
        uint256 validUntil,
        uint256 totalAmount,
        uint256 spentAmount
    );

    struct Session {
        uint256 startFrom;
        uint256 validUntil;
        uint256 totalAmount;
        uint256 spentAmount;
    }
    mapping(address => Session) internal sessions;

    function _addSession(address _sessionUser, uint256 _startFrom, uint256 _validUntil, uint256 _totalAmount) internal {
        require(_sessionUser != address(0), "SM: Invalid session user");
        require(_validUntil > _startFrom, "SM: validUntil must be greater than startFrom");
        sessions[_sessionUser] = Session(_startFrom, _validUntil, _totalAmount, 0);
        emit SessionCreated(_sessionUser, _startFrom, _validUntil, _totalAmount);
    }

    function _removeSession(address _sessionUser) internal {
        uint256 _startFrom = sessions[_sessionUser].startFrom;
        uint256 _validUntil = sessions[_sessionUser].validUntil;
        uint256 _totalAmount = sessions[_sessionUser].totalAmount;
        uint256 _spentAmount = sessions[_sessionUser].spentAmount;
        delete sessions[_sessionUser];
        emit SessionRemoved(_sessionUser, _startFrom, _validUntil, _totalAmount, _spentAmount);
    }

    function _increaseSpent(address _sessionUser, uint256 _amount) internal {
        sessions[_sessionUser].spentAmount += _amount;
    }

    function getSession(address _sessionUser) public view returns (Session memory) {
        return sessions[_sessionUser];
    }

    constructor() {}
}
