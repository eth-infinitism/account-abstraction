// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";

import {IEntryPoint} from "contracts/interfaces/IEntryPoint.sol";
import {UserOperation, UserOperationLib} from "contracts/interfaces/UserOperation.sol";
import {SimpleAccountFactory} from "contracts/samples/SimpleAccountFactory.sol";
import {SimpleAccount} from "contracts/samples/SimpleAccount.sol";
import {EntryPoint} from "contracts/core/EntryPoint.sol";

import {ConsiderationInterface} from "./interfaces/ConsiderationInterface.sol";
import {OrderComponents, OfferItem, ConsiderationItem, OrderParameters, AdvancedOrder, CriteriaResolver} from "./interfaces/ConsiderationStructs.sol";
import {OrderType, ItemType} from "./interfaces/ConsiderationEnums.sol";

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MockErc721 is ERC721 {
    constructor(string memory _name, string memory _symbol) ERC721(_name, _symbol) {}

    function mint(address to, uint256 tokenId) public {
        _mint(to, tokenId);
    }
}

contract TestSmartWallet is Test {
    IEntryPoint entryPoint;
    SimpleAccountFactory simpleAccountFactory;
    SimpleAccount simpleAccount;
    address walletOwner = vm.addr(1337);
    address smartWalletAccount;

    ConsiderationInterface constant seaport14 = ConsiderationInterface(0x00000000000001ad428e4906aE43D8F9852d0dD6);

    MockErc721 mockErc721;

    using ECDSA for bytes32;

    function setUp() public {
        entryPoint = new EntryPoint();
        simpleAccountFactory = new SimpleAccountFactory(entryPoint);

        simpleAccount = simpleAccountFactory.createAccount(walletOwner, 123);
        smartWalletAccount = simpleAccountFactory.getAddress(walletOwner, 123);

        mockErc721 = new MockErc721("MOCK", "MOCK");
    }

    function testSmartWalletSellErc721() public {
        mockErc721.mint(smartWalletAccount, 1);
        vm.prank(smartWalletAccount);
        mockErc721.setApprovalForAll(address(seaport14), true);

        (AdvancedOrder memory advancedOrder, bytes32 orderHash) = composeAdvancedOrder({
            offerItemType: ItemType.ERC721,
            offerToken: address(mockErc721),
            offerTokenId: 1,
            offerTokenAmount: 1,
            considerationItemType: ItemType.NATIVE,
            considerationToken: address(0),
            considerationTokenId: 0,
            considerationAmount: 1 ether,
            recipient: address(smartWalletAccount)
        });
        bytes memory signature = signOpenseaOrder(1337, orderHash);
        advancedOrder.signature = signature;

        address buyer = vm.addr(1338);
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        seaport14.fulfillAdvancedOrder{value: 1 ether}(advancedOrder, new CriteriaResolver[](0), 0, address(0));

        assertEq(mockErc721.ownerOf(1), buyer);
        assertEq(buyer.balance, 0);
        assertEq(address(smartWalletAccount).balance, 1 ether);
    }

    function testSmartWalletBuyErc721() public {
        address seller = vm.addr(1338);
        mockErc721.mint(seller, 1);
        vm.prank(seller);
        mockErc721.setApprovalForAll(address(seaport14), true);

        (AdvancedOrder memory advancedOrder, bytes32 orderHash) = composeAdvancedOrder({
            offerItemType: ItemType.ERC721,
            offerToken: address(mockErc721),
            offerTokenId: 1,
            offerTokenAmount: 1,
            considerationItemType: ItemType.NATIVE,
            considerationToken: address(0),
            considerationTokenId: 0,
            considerationAmount: 1 ether,
            recipient: address(seller)
        });

        bytes memory signature = signOpenseaOrder(1338, orderHash);
        advancedOrder.signature = signature;

        bytes memory seaportCalldata = abi.encodeWithSelector(
            ConsiderationInterface.fulfillAdvancedOrder.selector,
            advancedOrder,
            new CriteriaResolver[](0),
            bytes32(0),
            0
        );

        bytes memory callData = abi.encodeWithSelector(
            SimpleAccount.execute.selector,
            address(seaport14),
            1 ether,
            seaportCalldata
        );

        UserOperation[] memory userOperations = new UserOperation[](1);
        UserOperation memory userOperation = UserOperation({
            sender: smartWalletAccount,
            nonce: 0,
            initCode: "",
            callData: callData,
            callGasLimit: 10_000_000,
            verificationGasLimit: 10_000_000,
            preVerificationGas: 10_000_000,
            maxFeePerGas: 10_000_000,
            maxPriorityFeePerGas: 10_000_000,
            paymasterAndData: "",
            signature: ""
        });
        userOperations[0] = userOperation;

        bytes32 hash = entryPoint.getUserOpHash(userOperation);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(1337, hash.toEthSignedMessageHash());
        userOperation.signature = abi.encodePacked(r, s, v);

        // pre fund smartWalletAccount to buy NFT
        vm.deal(smartWalletAccount, 1 ether);
        // deposit gas fee
        entryPoint.depositTo{value: 1 ether}(smartWalletAccount);

        entryPoint.handleOps(userOperations, payable(walletOwner));

        assertEq(mockErc721.ownerOf(1), address(smartWalletAccount));
        assertEq(seller.balance, 1 ether);
        assertEq(address(smartWalletAccount).balance, 0);
    }

    function getOrderComponents(
        OrderParameters memory parameters
    ) internal view returns (OrderComponents memory) {
        return
            OrderComponents(
                parameters.offerer,
                parameters.zone,
                parameters.offer,
                parameters.consideration,
                parameters.orderType,
                parameters.startTime,
                parameters.endTime,
                parameters.zoneHash,
                parameters.salt,
                parameters.conduitKey,
                getCounter(parameters.offerer)
            );
    }

    function getCounter(address offerer) internal view returns(uint256) {
        return seaport14.getCounter(offerer);
    }

    function getOrderHash(
        OrderComponents memory order
    )
        internal view returns(bytes32)
    {
        return seaport14.getOrderHash(order);
    }

    function signOpenseaOrder(
        uint256 _pkOfSigner,
        bytes32 _orderHash
    ) internal view returns (bytes memory) {
        (bytes32 r, bytes32 s, uint8 v) = getSignatureComponents(
            seaport14,
            _pkOfSigner,
            _orderHash
        );
        return abi.encodePacked(r, s, v);
    }

    function getSignatureComponents(
        ConsiderationInterface consideration,
        uint256 _pkOfSigner,
        bytes32 _orderHash
    )
        internal
        view
        returns (
            bytes32,
            bytes32,
            uint8
        )
    {
        (, bytes32 domainSeparator, ) = consideration.information();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            _pkOfSigner,
            keccak256(
                abi.encodePacked(bytes2(0x1901), domainSeparator, _orderHash)
            )
        );
        return (r, s, v);
    }

    function composeAdvancedOrder(
        ItemType offerItemType,
        address offerToken,
        uint256 offerTokenId,
        uint256 offerTokenAmount,
        ItemType considerationItemType,
        address considerationToken,
        uint256 considerationTokenId,
        uint256 considerationAmount,
        address recipient
    ) internal view returns(AdvancedOrder memory, bytes32) {
        OfferItem[] memory offerItem = new OfferItem[](1);
        offerItem[0] = OfferItem({
            itemType: offerItemType,
            token: offerToken,
            identifierOrCriteria: offerTokenId,
            startAmount: offerTokenAmount,
            endAmount: offerTokenAmount
        });

        ConsiderationItem[] memory considerationItem = new ConsiderationItem[](1);
        considerationItem[0] = ConsiderationItem({
            itemType: considerationItemType,
            token: considerationToken,
            identifierOrCriteria: considerationTokenId,
            startAmount: considerationAmount,
            endAmount: considerationAmount,
            recipient: payable(recipient)
        });

        OrderParameters memory order = OrderParameters({
            offerer: recipient,
            zone: address(0),
            offer: offerItem,
            consideration: considerationItem,
            orderType: OrderType.FULL_OPEN,
            startTime: 1670829557,
            endTime: 1670829557 + 1 ether,
            zoneHash: bytes32(0),
            salt: uint256(keccak256("okx")),
            conduitKey: bytes32(0),
            totalOriginalConsiderationItems: 1
        });

        bytes32 orderHash = getOrderHash(getOrderComponents(order));
        AdvancedOrder memory advancedOrder = AdvancedOrder({
            parameters: order,
            numerator: 1,
            denominator: 1,
            signature: "", // place holder
            extraData: ""
        });

        return (advancedOrder, orderHash);
    }
}