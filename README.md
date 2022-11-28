# Dao Contract Example

This is a simple example of a DAO contract for ethereum.
It is a simple contract that allows users to create proposals and vote on them.
The contract is written in Solidity and uses the Hardhat framework for testing.
It's educational purpose only and should not be used in production.

Proposals are just a hash of the proposal data, so the data can be stored off-chain.
Anyone token holder can create a proposal and anyone can vote on it.
The contract keeps track of the number of votes for and against a proposal.
If the number of votes for a proposal is greater than half of the total number of tokens, the proposal is accepted.
Otherwise, it is rejected.
There cannot be more than 3 proposals at a time.
If proposal not accepted or rejected after 3 days, it is marked as expired when space is needed for new proposals.

DAO tokens are ERC20 tokens and are minted when a contract is deployed.
New tokens cannot be minted after the contract is deployed.
Tokens can be transferred to other addresses with correctly recalculated votes.

## Running the tests

To run you need to have [Node.js](https://nodejs.org)

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npx hardhat test
```

Run tests with coverage:

```bash
npx hardhat coverage
```

## Test with coverage output

```
  MyDao
    Deployment
      ✔ Should mint 100 tokens to the owner (361ms)
      ✔ Proposal count should be 0
    Create Proposal
      ✔ Successful create proposal (75ms)
      ✔ Account with no tokens should not be able to create proposal (59ms)
      ✔ Cannot be more than three pending proposals (102ms)
      ✔ Create two proposals with the same hash (64ms)
    Transfer
      ✔ Successful transfer (39ms)
      ✔ Transfer all tokens (38ms)
      ✔ Transfer more than balance
      ✔ Transfer from account with no tokens
      ✔ Scenario with transfer 25, 40, 35 tokens (112ms)
    Vote
      ✔ Successful vote YES (199ms)
      ✔ Successful vote NO (180ms)
      ✔ Account with no tokens should not be able to vote YES
      ✔ Account with no tokens should not be able to vote NO
      ✔ Proposal should not be expired to vote YES (162ms)
      ✔ Proposal should not be expired to vote NO (158ms)
      ✔ Change vote YES to NO (194ms)
      ✔ Change vote NO to YES (195ms)
      ✔ Cannot vote twice YES (173ms)
      ✔ Cannot vote twice NO (162ms)
      ✔ Retraction vote YES (162ms)
      ✔ Retraction vote NO (165ms)
      ✔ Cannot vote ABSTAIN (135ms)
      ✔ Cannot vote YES on non-existent proposal (113ms)
      ✔ Cannot vote NO on non-existent proposal (117ms)
      ✔ Cannot change vote YES to NO for expired proposal (156ms)
      ✔ Cannot change vote NO to YES for expired proposal (156ms)
      ✔ Vote YES when time is TTL (148ms)
      ✔ Vote NO when time is TTL (144ms)
      ✔ Change vote YES to NO when time is TTL (162ms)
      ✔ Change vote NO to YES when time is TTL (168ms)
      ✔ Retraction vote YES when time is TTL (152ms)
      ✔ Retraction vote NO when time is TTL (167ms)
    Transfer with voting
      ✔ Vote YES and transfer all tokens to ABSTAIN (182ms)
      ✔ Vote NO and transfer all tokens to ABSTAIN (207ms)
      ✔ Vote YES and transfer some tokens to ABSTAIN (191ms)
      ✔ Vote NO and transfer some tokens to ABSTAIN (182ms)
      ✔ Don't vote and transfer all tokens to ABSTAIN (154ms)
      ✔ Don't vote and transfer some tokens to ABSTAIN (168ms)
      ✔ Don't vote and transfer all tokens to YES (205ms)
      ✔ Don't vote and transfer all tokens to NO (269ms)
      ✔ Don't vote and transfer some tokens to YES (187ms)
      ✔ Don't vote and transfer some tokens to NO (301ms)
      ✔ Vote YES and transfer all tokens to NO (296ms)
      ✔ Vote YES and transfer all tokens to YES (319ms)
      ✔ Vote NO and transfer all tokens to NO (373ms)
      ✔ Vote NO and transfer all tokens to YES (656ms)
      ✔ Vote YES and transfer some tokens to NO (338ms)
      ✔ Vote YES and transfer some tokens to YES (295ms)
      ✔ Vote NO and transfer some tokens to NO (317ms)
      ✔ Vote NO and transfer some tokens to YES (277ms)
      ✔ Vote shouldn't be increase by transfer if proposal is expired (325ms)
      ✔ Vote shouldn't be increase by transfer if proposal is expired (202ms)
      ✔ Vote shouldn't decrease by transfer if proposal is expired (188ms)
      ✔ Vote shouldn't decrease by transfer if proposal is expired (249ms)
    Update proposal state
      ✔ One voter YES votes (69ms)
      ✔ One voter NO votes (55ms)
      ✔ ProposalAccepted of third proposal with two pendings (98ms)
      ✔ ProposalRejected of third proposal with two pendings (156ms)
      ✔ ProposalAccepted with 2 YES votes of 3 voters (177ms)
      ✔ ProposalRejected with 2 NO votes of 3 voters (168ms)
      ✔ ProposalAccepted with 2 YES and 1 NO votes of 3 voters (220ms)
      ✔ ProposalRejected with 2 NO and 1 YES votes of 3 voters (211ms)
      ✔ ProposalAccepted by transfer tokens (172ms)
      ✔ ProposalRejected by transfer tokens (178ms)
      ✔ ProposalAccepted by vote with minimum balance (210ms)
      ✔ ProposalRejected by vote with minimum balance (158ms)
      ✔ Replace expired proposal (103ms)


  69 passing (12s)

------------|----------|----------|----------|----------|----------------|
File        |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
------------|----------|----------|----------|----------|----------------|
 contracts/ |    98.57 |    95.83 |      100 |    98.84 |                |
  MyDao.sol |    98.57 |    95.83 |      100 |    98.84 |            266 |
------------|----------|----------|----------|----------|----------------|
All files   |    98.57 |    95.83 |      100 |    98.84 |                |
------------|----------|----------|----------|----------|----------------|
```