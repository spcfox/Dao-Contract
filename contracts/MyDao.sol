// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MyDao
 * @dev Implements voting process along with vote delegation
 */
contract MyDao is ERC20 {
    uint8 constant DECIMALS = 6;
    uint256 constant MDA = 10 ** DECIMALS;

    uint8 constant MAX_PROPOSALS = 3;
    uint256 constant VOTING_PERIOD = 3 days;

    enum Vote {Abstain, Yes, No}
    enum ProposalState {Pending, Accepted, Rejected, Expired}

    struct Proposal {
        bytes32 proposalHash;
        uint256 id;
        uint256 ttl;
        uint256 yesVotes;
        uint256 noVotes;
        ProposalState state;
        mapping(address => Vote) votes;
    }

    uint256[] public currentProposals;
    Proposal[] public proposals;

    event ProposalCreated(uint256 proposalId, bytes32 proposal, address creator);
    event ProposalAccepted(uint256 proposalId, bytes32 proposal);
    event ProposalRejected(uint256 proposalId, bytes32 proposal);
    event ProposalExpired(uint256 proposalId, bytes32 proposal);

    event Voted(uint256 proposalId, address voter, Vote vote);

    modifier onlyTokenHolders() {
        require(balanceOf(msg.sender) > 0, "You must hold tokens to vote or create proposals");
        _;
    }

    modifier proposalExists(uint256 proposalId) {
        require(proposalId < proposals.length, "Proposal does not exist");
        _;
    }

    /**
     * @dev Constructor that gives msg.sender all of existing tokens.
     */
    constructor() ERC20("MyDao", "MDA") {
        _mint(msg.sender, 100 * MDA);
    }

    function decimals() public view virtual override returns (uint8) {
        return DECIMALS;
    }

    /**
     * @dev Get vote of a voter for a proposal
     * @param _proposalId uint256 ID of the proposal
     * @param _voter address of the voter
     * @return Vote of the voter
     */
    function getVote(uint256 _proposalId, address _voter) public view proposalExists(_proposalId) returns (Vote) {
        return proposals[_proposalId].votes[_voter];
    }

    /**
     * @dev Get proposal count
     * @return uint256 proposal count
     */
    function proposalsCount() public view returns (uint256) {
        return proposals.length;
    }

    /**
     * @dev Creates a new proposal
     * @param _proposalHash The hash of the proposal
     */
    function createProposal(bytes32 _proposalHash) public onlyTokenHolders {
        assert(currentProposals.length <= MAX_PROPOSALS);

        if (currentProposals.length == MAX_PROPOSALS) {
            uint256 oldestProposalId = currentProposals[0];
            Proposal storage oldestProposal = proposals[oldestProposalId];
            if (oldestProposal.ttl < block.timestamp) {
                oldestProposal.state = ProposalState.Expired;
                emit ProposalExpired(oldestProposalId, oldestProposal.proposalHash);
                delete currentProposals[0];
            } else {
                revert("Max number of pending proposals reached");
            }
        }

        uint256 id = proposals.length;

        Proposal storage proposal = proposals.push();
        proposal.proposalHash = _proposalHash;
        proposal.id = id;
        proposal.ttl = block.timestamp + VOTING_PERIOD;
        proposal.yesVotes = 0;
        proposal.noVotes = 0;
        proposal.state = ProposalState.Pending;

        currentProposals.push(id);

        emit ProposalCreated(id, _proposalHash, msg.sender);
    }

    /**
     * @dev Vote for a proposal
     * @param _proposalId uint256 ID of the proposal
     * @param _vote Vote to cast
     */
    function vote(uint256 _proposalId, Vote _vote) public onlyTokenHolders proposalExists(_proposalId) {
        Proposal storage proposal = proposals[_proposalId];

        require(proposal.state == ProposalState.Pending, "Proposal is not pending");
        require(proposal.ttl >= block.timestamp, "Proposal is expired");
        require(proposal.votes[msg.sender] != _vote, "You already voted this way");

        uint256 amount = balanceOf(msg.sender);

        _subVotes(proposal, proposal.votes[msg.sender], amount);
        _addVotes(proposal, _vote, amount);

        _changeVote(proposal, msg.sender, _vote);

        _checkProposalState(proposal, _vote);
    }

    function _transfer(address _sender, address _recipient, uint256 _amount) internal virtual override {
        super._transfer(_sender, _recipient, _amount);

        for (uint8 i = 0; i < currentProposals.length; i++) {
            uint256 proposalId = currentProposals[i];

            Proposal storage proposal = proposals[proposalId];

            if (proposal.ttl < block.timestamp) {
                continue;
            }

            Vote senderVote = proposal.votes[_sender];
            Vote recipientVote = proposal.votes[_recipient];

            if (senderVote != Vote.Abstain && balanceOf(_sender) == 0) {
                _changeVote(proposal, _sender, Vote.Abstain);
            }

            if (senderVote != recipientVote) {
                _subVotes(proposal, senderVote, _amount);
                _addVotes(proposal, recipientVote, _amount);

                if (recipientVote != Vote.Abstain) {
                    _checkProposalState(proposal, recipientVote);
                }
            }
        }
    }

    /**
     * @dev Add votes from a proposal
     * @param _proposal Proposal to add votes from
     * @param _vote Vote to add
     * @param _amount Amount of votes to add
     */
    function _addVotes(Proposal storage _proposal, Vote _vote, uint256 _amount) internal {
        if (_vote == Vote.Yes) {
            _proposal.yesVotes += _amount;
        } else if (_vote == Vote.No) {
            _proposal.noVotes += _amount;
        }
    }

    /**
     * @dev Subtract votes from a proposal
     * @param _proposal Proposal to subtract votes from
     * @param _vote Vote to subtract
     * @param _amount Amount of votes to subtract
     */
    function _subVotes(Proposal storage _proposal, Vote _vote, uint256 _amount) internal {
        if (_vote == Vote.Yes) {
            _proposal.yesVotes -= _amount;
        } else if (_vote == Vote.No) {
            _proposal.noVotes -= _amount;
        }
    }

    /**
     * @dev Check if a proposal has been accepted or rejected
     * @param _proposal Proposal to check
     * @param _vote Vote to check
     */
    function _checkProposalState(Proposal storage _proposal, Vote _vote) internal {
        assert(_proposal.state == ProposalState.Pending);

        if (_vote == Vote.Yes) {
            _checkProposalAccepted(_proposal);
        } else if (_vote == Vote.No) {
            _checkProposalRejected(_proposal);
        }
    }

    /**
     * @dev Check if a proposal has been accepted
     * @param _proposal Proposal to check
     */
    function _checkProposalAccepted(Proposal storage _proposal) internal {
        assert(_proposal.state == ProposalState.Pending);
        assert(_proposal.yesVotes > 0);

        if (_proposal.yesVotes > totalSupply() / 2) {
            assert(_proposal.yesVotes > _proposal.noVotes);

            _proposal.state = ProposalState.Accepted;
            emit ProposalAccepted(_proposal.id, _proposal.proposalHash);
            _removeProposal(_proposal.id);
        }
    }

    /**
     * @dev Check if a proposal has been rejected
     * @param _proposal Proposal to check
     */
    function _checkProposalRejected(Proposal storage _proposal) internal {
        assert(_proposal.state == ProposalState.Pending);
        assert(_proposal.noVotes > 0);

        if (_proposal.noVotes > totalSupply() / 2) {
            assert(_proposal.noVotes > _proposal.yesVotes);

            _proposal.state = ProposalState.Rejected;
            emit ProposalRejected(_proposal.id, _proposal.proposalHash);
            _removeProposal(_proposal.id);
        }
    }

    function _changeVote(Proposal storage _proposal, address _voter, Vote _vote) internal {
        assert(_proposal.state == ProposalState.Pending);
        assert(_proposal.votes[_voter] != _vote);

        _proposal.votes[_voter] = _vote;
        emit Voted(_proposal.id, _voter, _vote);
    }

    /**
     * @dev Remove a proposal from the current proposals array
     * @param _proposalId uint256 ID of the proposal
     */
    function _removeProposal(uint256 _proposalId) internal {
        assert(currentProposals.length > 0);
        assert(_proposalId < currentProposals.length);

        for (uint8 i = 0; i < currentProposals.length; i++) {
            if (currentProposals[i] == _proposalId) {
                delete currentProposals[i];
                return;
            }
        }

        // This should never happen
        revert("Proposal not found");
    }
}
