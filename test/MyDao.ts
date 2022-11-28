import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import itParam from 'mocha-param';
import { MyDao } from '../typechain-types';

const DECIMALS = 6;
const DAY = 24 * 60 * 60;
const VOTING_PERIOD = 3 * DAY;

enum Vote { Abstain, Yes, No }

enum ProposalState { Pending, Accepted, Rejected, Expired }

interface VoteInfo {
    value: Vote,
    name: string,
    successState: ProposalState,
    successEvent: string,
}

const yes: VoteInfo = {
    value: Vote.Yes,
    name: 'YES',
    successState: ProposalState.Accepted,
    successEvent: 'ProposalAccepted'
};
const no: VoteInfo = {
    value: Vote.No,
    name: 'NO',
    successState: ProposalState.Rejected,
    successEvent: 'ProposalRejected'
};

const TEST_PROPOSAL = 'Test proposal';
const TEST_PROPOSAL_HASH = getProposalHash(TEST_PROPOSAL);

function createProposalHash(id: number): string {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`Proposal ${id}`));
}

function getProposalHash(proposal: string): string {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(proposal));
}

function checkProposal(proposal: any, expected: any): void {
    for (const [key, value] of Object.entries(expected)) {
        expect(proposal[key])
            .to.equal(value, `Proposal ${key} is not correct`);
    }
}

describe('MyDao', function() {
    async function deployMyDaoFixture() {
        const [owner, noTokensAccount, ...otherAccounts] = await ethers.getSigners();
        const MyDao = await ethers.getContractFactory('MyDao');
        const myDao = await MyDao.deploy();
        const totalSupply = ethers.utils.parseUnits('100', DECIMALS);
        return { myDao, owner, noTokensAccount, otherAccounts, totalSupply };
    }

    function createFixture(rawBalances: number[]) {
        return async function() {
            const { myDao, owner, noTokensAccount, otherAccounts, totalSupply } = await deployMyDaoFixture();

            const balances = rawBalances.map((x) => ethers.utils.parseUnits(x.toString(), DECIMALS));
            const voters = otherAccounts.slice(0, balances.length);

            expect(balances.reduce((a, b) => a.add(b)))
                .to.equal(totalSupply, 'Balances sum should be equal to total supply');

            for (let i = 0; i < voters.length; i++) {
                await myDao.transfer(voters[i].address, balances[i]);
            }

            expect(await myDao.balanceOf(owner.address)).to.equal(0, 'Owner should have no tokens');

            return { myDao, noTokensAccount, owner, voters, balances };
        };
    }

    async function minimumBalanceFixture() {
        const { myDao, owner, noTokensAccount, otherAccounts, totalSupply } = await deployMyDaoFixture();

        const [minimumBalanceAccount, halfSupplyAccount] = otherAccounts;

        await myDao.transfer(minimumBalanceAccount.address, 1);
        await myDao.transfer(halfSupplyAccount.address, totalSupply.div(2));

        return { myDao, noTokensAccount, owner, minimumBalanceAccount, halfSupplyAccount };
    }

    const threeVotersFixture = createFixture([25, 40, 35]);
    const fourVotersFixture = createFixture([5, 10, 15, 70]);

    describe('Deployment', function() {
        it('Should mint 100 tokens to the owner', async function() {
            const { myDao, owner, totalSupply } = await loadFixture(deployMyDaoFixture);

            expect(await myDao.decimals())
                .to.equal(DECIMALS, `Decimals should be ${DECIMALS}`);
            expect(await myDao.balanceOf(owner.address))
                .to.equal(totalSupply, `Owner should have ${totalSupply} tokens`);
            expect(await myDao.totalSupply())
                .to.equal(totalSupply, `Total supply should be ${totalSupply}`);
        });

        it('Proposal count should be 0', async function() {
            const { myDao } = await loadFixture(deployMyDaoFixture);

            expect(await myDao.proposalsCount()).to.equal(0, 'Proposals count should be 0');
        });
    });

    describe('Create Proposal', function() {
        it('Successful create proposal', async function() {
            const { myDao, owner } = await loadFixture(deployMyDaoFixture);
            const proposalHash = TEST_PROPOSAL_HASH;

            const proposalId = await myDao.proposalsCount();

            expect(await myDao.createProposal(proposalHash))
                .to.emit(myDao, 'ProposalCreated').withArgs(proposalId, proposalHash, owner.address);
            expect(await myDao.proposalsCount())
                .to.equal(1, 'Proposals count should be 1');

            checkProposal(await myDao.proposals(proposalId), {
                proposalHash,
                id: proposalId,
                ttl: await time.latest() + VOTING_PERIOD,
                yesVotes: 0,
                noVotes: 0,
                state: ProposalState.Pending,
            });
            expect(await myDao.getVote(proposalId, owner.address))
                .to.equal(Vote.Abstain, 'Proposal owner vote should be ABSTAIN');
        });

        it('Account with no tokens should not be able to create proposal', async function() {
            const { myDao, noTokensAccount } = await loadFixture(deployMyDaoFixture);

            await expect(myDao.connect(noTokensAccount).createProposal(TEST_PROPOSAL_HASH))
                .to.be.revertedWith('You must hold tokens to vote or create proposals');
        });

        it('Cannot be more than three pending proposals', async function() {
            const { myDao, owner } = await loadFixture(deployMyDaoFixture);

            for (let i = 0; i < 3; i++) {
                const proposalHash = createProposalHash(i);
                await expect(myDao.createProposal(proposalHash))
                    .to.emit(myDao, 'ProposalCreated').withArgs(i, proposalHash, owner.address);
            }

            await expect(myDao.createProposal(TEST_PROPOSAL_HASH))
                .to.be.revertedWith('Max number of pending proposals reached');
        });

        it('Create two proposals with the same hash', async function() {
            const { myDao, owner } = await loadFixture(deployMyDaoFixture);

            const proposalHash = TEST_PROPOSAL_HASH;

            await expect(myDao.createProposal(proposalHash))
                .to.emit(myDao, 'ProposalCreated').withArgs(0, proposalHash, owner.address);
            await expect(myDao.createProposal(proposalHash))
                .to.emit(myDao, 'ProposalCreated').withArgs(1, proposalHash, owner.address);
        });
    });

    describe('Transfer', function() {
        async function checkTransfer(
            myDao: MyDao,
            from: SignerWithAddress,
            to: SignerWithAddress,
            amount: BigNumber,
            expected: BigNumber
        ) {
            expect(await myDao.balanceOf(to.address))
                .to.equal(0, 'Recipient should have no tokens');
            await expect(myDao.connect(from).transfer(to.address, amount))
                .to.emit(myDao, 'Transfer').withArgs(from.address, to.address, amount);
            expect(await myDao.balanceOf(to.address))
                .to.equal(amount, `Recipient should have ${amount} tokens`);
            expect(await myDao.balanceOf(from.address))
                .to.equal(expected, `Owner should have ${expected} tokens`);
        }

        it('Successful transfer', async function() {
            const { myDao, owner, otherAccounts, totalSupply } = await loadFixture(deployMyDaoFixture);
            const [recipient] = otherAccounts;
            const amount = ethers.utils.parseUnits('10', DECIMALS);

            await checkTransfer(myDao, owner, recipient, amount, totalSupply.sub(amount));
        });

        it('Transfer all tokens', async function() {
            const { myDao, owner, otherAccounts, totalSupply } = await loadFixture(deployMyDaoFixture);
            const [recipient] = otherAccounts;

            expect(await myDao.balanceOf(recipient.address))
                .to.equal(0, 'Recipient should have no tokens');
            await expect(myDao.transfer(recipient.address, totalSupply))
                .to.emit(myDao, 'Transfer').withArgs(owner.address, recipient.address, totalSupply);
            expect(await myDao.balanceOf(recipient.address))
                .to.equal(totalSupply, `Recipient should have ${totalSupply} tokens`);
            expect(await myDao.balanceOf(owner.address))
                .to.equal(0, 'Owner should have no tokens');
        });

        it('Transfer more than balance', async function() {
            const { myDao, owner, totalSupply } = await loadFixture(deployMyDaoFixture);
            const amount = totalSupply.add(1);

            await expect(myDao.transfer(owner.address, amount))
                .to.be.revertedWith('ERC20: transfer amount exceeds balance');
        });

        it('Transfer from account with no tokens', async function() {
            const { myDao, noTokensAccount, owner } = await loadFixture(deployMyDaoFixture);

            await expect(myDao.connect(noTokensAccount).transfer(owner.address, 1))
                .to.be.revertedWith('ERC20: transfer amount exceeds balance');
        });

        it('Scenario with transfer 25, 40, 35 tokens', async function() {
            const { myDao, owner, otherAccounts, totalSupply } = await loadFixture(deployMyDaoFixture);
            const amounts = [25, 40, 35].map(amount => ethers.utils.parseUnits(amount.toString(), DECIMALS));
            const recipients = otherAccounts.slice(0, amounts.length);

            expect(amounts.reduce((a, b) => a.add(b)))
                .to.equal(totalSupply, 'Balances sum should be equal to total supply');

            let totalTransferred = ethers.BigNumber.from(0);
            for (let i = 0; i < recipients.length; i++) {
                const recipient = recipients[i];
                const amount = amounts[i];

                totalTransferred = totalTransferred.add(amount);

                await checkTransfer(myDao, owner, recipient, amount, totalSupply.sub(totalTransferred));
            }
        });
    });

    describe('Vote', function() {
        itParam('Successful vote ${value.name}', [yes, no],
            async function(vote: VoteInfo) {
                const { myDao, voters, balances } = await threeVotersFixture();
                const proposalId = 0;
                const proposalHash = TEST_PROPOSAL_HASH;

                const creator = voters[0];
                const voter = voters[1];
                const voterBalance = balances[1];

                await myDao.connect(creator).createProposal(proposalHash);

                const ttl = await time.latest() + VOTING_PERIOD;

                expect(await myDao.connect(voter).vote(proposalId, vote.value))
                    .to.emit(myDao, 'Voted').withArgs(proposalId, voter.address, vote.value);
                expect(await myDao.getVote(proposalId, voter.address))
                    .to.equal(vote.value, `Voter vote should be ${vote.name}`);
                expect(await myDao.getVote(proposalId, creator.address))
                    .to.equal(Vote.Abstain, 'Proposal creator vote should be ABSTAIN');
                checkProposal(await myDao.proposals(proposalId), {
                    proposalHash,
                    id: proposalId,
                    ttl,
                    yesVotes: vote.value == Vote.Yes ? voterBalance : 0,
                    noVotes: vote.value == Vote.No ? voterBalance : 0,
                    state: ProposalState.Pending,
                });
            });

        itParam('Account with no tokens should not be able to vote ${value.name}', [yes, no],
            async function(vote: VoteInfo) {
                const { myDao, noTokensAccount } = await loadFixture(deployMyDaoFixture);

                await expect(myDao.connect(noTokensAccount).vote(0, vote.value))
                    .to.be.revertedWith('You must hold tokens to vote or create proposals');
            });

        itParam('Proposal should not be expired to vote ${value.name}', [yes, no],
            async function(vote: VoteInfo) {
                const { myDao, voters } = await threeVotersFixture();
                const proposalId = 0;

                const creator = voters[0];
                const voter = voters[1];

                await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);

                await time.setNextBlockTimestamp(await time.latest() + VOTING_PERIOD + 1);

                await expect(myDao.connect(voter).vote(proposalId, vote.value))
                    .to.be.revertedWith('Proposal is expired');
                expect((await myDao.proposals(proposalId)).ttl).to.lessThan(await time.latest());
            });

        itParam('Change vote ${value[0].name} to ${value[1].name}', [[yes, no], [no, yes]],
            async function(votes: VoteInfo[]) {
                const { myDao, voters, balances } = await threeVotersFixture();
                const proposalId = 0;

                const creator = voters[0];
                const voter = voters[1];
                const voterBalance = balances[1];

                await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);

                const ttl = await time.latest() + VOTING_PERIOD;

                await myDao.connect(voter).vote(proposalId, votes[0].value);

                expect(await myDao.connect(voter).vote(proposalId, votes[1].value))
                    .to.emit(myDao, 'Voted').withArgs(proposalId, voter.address, votes[1].value);
                expect(await myDao.getVote(proposalId, voter.address))
                    .to.equal(votes[1].value, `Voter vote should be ${votes[1].name}`);
                expect(await myDao.getVote(proposalId, creator.address))
                    .to.equal(Vote.Abstain, 'Proposal creator vote should be ABSTAIN');
                checkProposal(await myDao.proposals(proposalId), {
                    proposalHash: TEST_PROPOSAL_HASH,
                    id: proposalId,
                    ttl: ttl,
                    yesVotes: votes[1].value == Vote.Yes ? voterBalance : 0,
                    noVotes: votes[1].value == Vote.No ? voterBalance : 0,
                    state: ProposalState.Pending,
                });
            });

        itParam('Cannot vote twice ${value.name}', [yes, no], async function(vote: VoteInfo) {
            const { myDao, voters } = await threeVotersFixture();
            const proposalId = 0;

            const creator = voters[0];
            const voter = voters[1];

            await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
            await myDao.connect(voter).vote(proposalId, vote.value);

            await expect(myDao.connect(voter).vote(proposalId, vote.value))
                .to.be.revertedWith('You already voted this way');
        });

        itParam('Retraction vote ${value.name}', [yes, no], async function(vote: VoteInfo) {
            const { myDao, voters } = await threeVotersFixture();
            const proposalId = 0;

            const creator = voters[0];
            const voter = voters[1];

            await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
            await myDao.connect(voter).vote(proposalId, vote.value);

            await expect(myDao.connect(voter).vote(proposalId, Vote.Abstain))
                .to.emit(myDao, 'Voted').withArgs(proposalId, voter.address, Vote.Abstain);
        });

        it('Cannot vote ABSTAIN', async function() {
            const { myDao, voters } = await threeVotersFixture();
            const proposalId = 0;

            const creator = voters[0];
            const voter = voters[1];

            await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);

            await expect(myDao.connect(voter).vote(proposalId, Vote.Abstain))
                .to.be.revertedWith('You already voted this way');
        });

        itParam('Cannot vote ${value.name} on non-existent proposal', [yes, no],
            async function(vote: VoteInfo) {
                const { myDao, voters } = await threeVotersFixture();
                const proposalId = 0;

                const voter = voters[1];

                await expect(myDao.connect(voter).vote(proposalId, vote.value))
                    .to.be.revertedWith('Proposal does not exist');
            });

        itParam('Cannot change vote ${value[0].name} to ${value[1].name} for expired proposal', [[yes, no], [no, yes]],
            async function(votes: VoteInfo[]) {
                const { myDao, voters } = await threeVotersFixture();
                const proposalId = 0;

                const creator = voters[0];
                const voter = voters[1];

                await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
                await myDao.connect(voter).vote(proposalId, votes[0].value);

                await time.setNextBlockTimestamp(await time.latest() + VOTING_PERIOD + 1);

                await expect(myDao.connect(voter).vote(proposalId, votes[1].value))
                    .to.be.revertedWith('Proposal is expired');
                expect((await myDao.proposals(proposalId)).ttl).to.lessThan(await time.latest());
            });

        itParam('Vote ${value.name} when time is TTL', [yes, no], async function(vote: VoteInfo) {
            const { myDao, voters } = await threeVotersFixture();
            const proposalId = 0;

            const creator = voters[0];
            const voter = voters[1];

            await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
            await time.setNextBlockTimestamp(await time.latest() + VOTING_PERIOD);

            await expect(myDao.connect(voter).vote(proposalId, vote.value))
                .to.emit(myDao, 'Voted').withArgs(proposalId, voter.address, vote.value);
            expect((await myDao.proposals(proposalId)).ttl).to.equal(await time.latest());
        });

        itParam('Change vote ${value[0].name} to ${value[1].name} when time is TTL', [[yes, no], [no, yes]],
            async function(votes: VoteInfo[]) {
                const { myDao, voters } = await threeVotersFixture();
                const proposalId = 0;

                const creator = voters[0];
                const voter = voters[1];

                await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
                await myDao.connect(voter).vote(proposalId, votes[0].value);
                await time.setNextBlockTimestamp(await time.latest() + VOTING_PERIOD - 1);

                await expect(myDao.connect(voter).vote(proposalId, votes[1].value))
                    .to.emit(myDao, 'Voted').withArgs(proposalId, voter.address, votes[1].value);
                expect((await myDao.proposals(proposalId)).ttl).to.equal(await time.latest());
            });

        itParam('Retraction vote ${value.name} when time is TTL', [yes, no], async function(vote: VoteInfo) {
            const { myDao, voters } = await threeVotersFixture();
            const proposalId = 0;

            const creator = voters[0];
            const voter = voters[1];

            await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
            await myDao.connect(voter).vote(proposalId, vote.value);
            await time.setNextBlockTimestamp(await time.latest() + VOTING_PERIOD - 1);

            await expect(myDao.connect(voter).vote(proposalId, Vote.Abstain))
                .to.emit(myDao, 'Voted').withArgs(proposalId, voter.address, Vote.Abstain);
            expect((await myDao.proposals(proposalId)).ttl).to.equal(await time.latest());
        });
    });

    describe('Transfer with voting', function() {
        itParam('Vote ${value.name} and transfer all tokens to ABSTAIN', [yes, no], async function(vote: VoteInfo) {
            const { myDao, voters, balances } = await fourVotersFixture();
            const proposalId = 0;

            const creator = voters[0];
            const voter = voters[1];
            const voterBalance = balances[1];

            await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
            await myDao.connect(voter).vote(proposalId, vote.value);

            await expect(myDao.connect(voter).transfer(creator.address, voterBalance))
                .to.emit(myDao, 'Voted').withArgs(proposalId, voter.address, Vote.Abstain);
            expect(await myDao.getVote(proposalId, voter.address))
                .to.equal(Vote.Abstain, 'Voter vote should be ABSTAIN');
            expect(await myDao.getVote(proposalId, creator.address))
                .to.equal(Vote.Abstain, 'Proposal creator vote should be ABSTAIN');
            checkProposal(await myDao.proposals(proposalId), {
                proposalHash: TEST_PROPOSAL_HASH,
                id: proposalId,
                yesVotes: 0,
                noVotes: 0,
                state: ProposalState.Pending,
            });
        });

        itParam('Vote ${value.name} and transfer some tokens to ABSTAIN', [yes, no],
            async function(vote: VoteInfo) {
                const { myDao, voters, balances } = await fourVotersFixture();
                const proposalId = 0;

                const creator = voters[0];
                const voter = voters[1];
                const voterBalance = balances[1];
                const transferAmount = voterBalance.div(2);

                await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
                await myDao.connect(voter).vote(proposalId, vote.value);

                await expect(myDao.connect(voter).transfer(creator.address, transferAmount))
                    .to.not.emit(myDao, 'Voted');
                expect(await myDao.getVote(proposalId, voter.address))
                    .to.equal(vote.value, 'Voter vote should be the same');
                expect(await myDao.getVote(proposalId, creator.address))
                    .to.equal(Vote.Abstain, 'Proposal creator vote should be ABSTAIN');
                checkProposal(await myDao.proposals(proposalId), {
                    proposalHash: TEST_PROPOSAL_HASH,
                    id: proposalId,
                    yesVotes: vote.value === Vote.Yes ? voterBalance.sub(transferAmount) : 0,
                    noVotes: vote.value === Vote.No ? voterBalance.sub(transferAmount) : 0,
                    state: ProposalState.Pending,
                });
            });

        it('Don\'t vote and transfer all tokens to ABSTAIN', async function() {
            const { myDao, voters, balances } = await fourVotersFixture();
            const proposalId = 0;

            const creator = voters[0];
            const voter = voters[1];
            const voterBalance = balances[1];

            await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);

            await expect(myDao.connect(voter).transfer(creator.address, voterBalance))
                .to.not.emit(myDao, 'Voted');
            expect(await myDao.getVote(proposalId, voter.address))
                .to.equal(Vote.Abstain, 'Voter vote should be ABSTAIN');
            expect(await myDao.getVote(proposalId, creator.address))
                .to.equal(Vote.Abstain, 'Proposal creator vote should be ABSTAIN');
            checkProposal(await myDao.proposals(proposalId), {
                proposalHash: TEST_PROPOSAL_HASH,
                id: proposalId,
                yesVotes: 0,
                noVotes: 0,
                state: ProposalState.Pending,
            });
        });

        it('Don\'t vote and transfer some tokens to ABSTAIN', async function() {
            const { myDao, voters, balances } = await fourVotersFixture();
            const proposalId = 0;

            const creator = voters[0];
            const voter = voters[1];
            const voterBalance = balances[1];
            const transferAmount = voterBalance.div(2);

            await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);

            await expect(myDao.connect(voter).transfer(creator.address, transferAmount))
                .to.not.emit(myDao, 'Voted');
            expect(await myDao.getVote(proposalId, voter.address))
                .to.equal(Vote.Abstain, 'Voter vote should be ABSTAIN');
            expect(await myDao.getVote(proposalId, creator.address))
                .to.equal(Vote.Abstain, 'Proposal creator vote should be ABSTAIN');
            checkProposal(await myDao.proposals(proposalId), {
                proposalHash: TEST_PROPOSAL_HASH,
                id: proposalId,
                yesVotes: 0,
                noVotes: 0,
                state: ProposalState.Pending,
            });
        });

        itParam('Don\'t vote and transfer all tokens to ${value.name}', [yes, no], async function(vote: VoteInfo) {
            const { myDao, voters, balances } = await fourVotersFixture();
            const proposalId = 0;

            const creator = voters[0];
            const voter1 = voters[1];
            const voter2 = voters[2];
            const voterBalance1 = balances[1];
            const voterBalance2 = balances[2];

            await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);

            await myDao.connect(voter2).vote(proposalId, vote.value);

            await expect(myDao.connect(voter1).transfer(voter2.address, voterBalance1))
                .to.not.emit(myDao, 'Voted');
            expect(await myDao.getVote(proposalId, voter1.address))
                .to.equal(Vote.Abstain, 'Voter vote should be ABSTAIN');
            expect(await myDao.getVote(proposalId, voter2.address))
                .to.equal(vote.value, 'Voter vote should be the same');
            checkProposal(await myDao.proposals(proposalId), {
                proposalHash: TEST_PROPOSAL_HASH,
                id: proposalId,
                yesVotes: vote.value === Vote.Yes ? voterBalance2.add(voterBalance1) : 0,
                noVotes: vote.value === Vote.No ? voterBalance2.add(voterBalance1) : 0,
                state: ProposalState.Pending,
            });
        });

        itParam('Don\'t vote and transfer some tokens to ${value.name}', [yes, no], async function(vote: VoteInfo) {
            const { myDao, voters, balances } = await fourVotersFixture();
            const proposalId = 0;

            const creator = voters[0];
            const voter1 = voters[1];
            const voter2 = voters[2];
            const voterBalance1 = balances[1];
            const voterBalance2 = balances[2];
            const transferAmount = voterBalance1.div(2);

            await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);

            await myDao.connect(voter2).vote(proposalId, vote.value);

            await expect(myDao.connect(voter1).transfer(voter2.address, transferAmount))
                .to.not.emit(myDao, 'Voted');
            expect(await myDao.getVote(proposalId, voter1.address))
                .to.equal(Vote.Abstain, 'Voter vote should be ABSTAIN');
            expect(await myDao.getVote(proposalId, voter2.address))
                .to.equal(vote.value, 'Voter vote should be the same');
            checkProposal(await myDao.proposals(proposalId), {
                proposalHash: TEST_PROPOSAL_HASH,
                id: proposalId,
                yesVotes: vote.value === Vote.Yes ? voterBalance2.add(transferAmount) : 0,
                noVotes: vote.value === Vote.No ? voterBalance2.add(transferAmount) : 0,
                state: ProposalState.Pending,
            });
        });

        itParam('Vote ${value[0].name} and transfer all tokens to ${value[1].name}',
            [[yes, no], [yes, yes], [no, no], [no, yes]],
            async function(votes: [VoteInfo, VoteInfo]) {
                const { myDao, voters, balances } = await fourVotersFixture();
                const proposalId = 0;

                const creator = voters[0];
                const voter1 = voters[1];
                const voter2 = voters[2];
                const voterBalance1 = balances[1];
                const voterBalance2 = balances[2];

                await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
                await myDao.connect(voter1).vote(proposalId, votes[0].value);
                await myDao.connect(voter2).vote(proposalId, votes[1].value);

                await expect(myDao.connect(voter1).transfer(voter2.address, voterBalance1))
                    .to.emit(myDao, 'Voted').withArgs(proposalId, voter1.address, Vote.Abstain);
                expect(await myDao.getVote(proposalId, voter1.address))
                    .to.equal(Vote.Abstain, 'Voter vote should be ABSTAIN');
                expect(await myDao.getVote(proposalId, voter2.address))
                    .to.equal(votes[1].value, 'Voter vote should be the same');
                checkProposal(await myDao.proposals(proposalId), {
                    proposalHash: TEST_PROPOSAL_HASH,
                    id: proposalId,
                    yesVotes: votes[1].value === Vote.Yes ? voterBalance2.add(voterBalance1) : 0,
                    noVotes: votes[1].value === Vote.No ? voterBalance2.add(voterBalance1) : 0,
                    state: ProposalState.Pending,
                });
            });

        itParam('Vote ${value[0].name} and transfer some tokens to ${value[1].name}',
            [[yes, no], [yes, yes], [no, no], [no, yes]],
            async function(votes: [VoteInfo, VoteInfo]) {
                const { myDao, voters, balances } = await fourVotersFixture();
                const proposalId = 0;

                const creator = voters[0];
                const voter1 = voters[1];
                const voter2 = voters[2];
                const voterBalance1 = balances[1];
                const voterBalance2 = balances[2];
                const transferAmount = voterBalance1.div(2);

                await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
                await myDao.connect(voter1).vote(proposalId, votes[0].value);
                await myDao.connect(voter2).vote(proposalId, votes[1].value);

                await expect(myDao.connect(voter1).transfer(voter2.address, transferAmount))
                    .to.not.emit(myDao, 'Voted');
                expect(await myDao.getVote(proposalId, voter1.address))
                    .to.equal(votes[0].value, 'Voter vote should be the same');
                expect(await myDao.getVote(proposalId, voter2.address))
                    .to.equal(votes[1].value, 'Voter vote should be the same');

                const yesVotes = (votes[0].value === Vote.Yes ? voterBalance1.sub(transferAmount) : BigNumber.from(0))
                    .add((votes[1].value === Vote.Yes ? voterBalance2.add(transferAmount) : 0));
                const noVotes = (votes[0].value === Vote.No ? voterBalance1.sub(transferAmount) : BigNumber.from(0))
                    .add((votes[1].value === Vote.No ? voterBalance2.add(transferAmount) : 0));
                checkProposal(await myDao.proposals(proposalId), {
                    proposalHash: TEST_PROPOSAL_HASH,
                    id: proposalId,
                    yesVotes,
                    noVotes,
                    state: ProposalState.Pending,
                });
            });

        itParam('Vote shouldn\'t be increase by transfer if proposal is expired', [yes, no],
            async function(vote: VoteInfo) {
                const { myDao, voters, balances } = await fourVotersFixture();
                const proposalId = 0;

                const creator = voters[0];
                const voter1 = voters[1];
                const voter2 = voters[2];
                const voterBalance1 = balances[1];
                const voterBalance2 = balances[2];

                await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
                await myDao.connect(voter1).vote(proposalId, vote.value);

                await time.increase(VOTING_PERIOD);

                checkProposal(await myDao.proposals(proposalId), {
                    yesVotes: vote.value === Vote.Yes ? voterBalance1 : 0,
                    noVotes: vote.value === Vote.No ? voterBalance1 : 0,
                    state: ProposalState.Pending,
                });

                await expect(myDao.connect(voter2).transfer(voter1.address, voterBalance2))
                    .to.not.emit(myDao, vote.successEvent);

                checkProposal(await myDao.proposals(proposalId), {
                    yesVotes: vote.value === Vote.Yes ? voterBalance1 : 0,
                    noVotes: vote.value === Vote.No ? voterBalance1 : 0,
                    state: ProposalState.Pending,
                });
            });

        itParam('Vote shouldn\'t decrease by transfer if proposal is expired', [yes, no],
            async function(vote: VoteInfo) {
                const { myDao, voters, balances } = await fourVotersFixture();
                const proposalId = 0;

                const creator = voters[0];
                const voter1 = voters[1];
                const voter2 = voters[2];
                const voterBalance1 = balances[1];

                await myDao.connect(creator).createProposal(TEST_PROPOSAL_HASH);
                await myDao.connect(voter1).vote(proposalId, vote.value);

                await time.increase(VOTING_PERIOD);

                checkProposal(await myDao.proposals(proposalId), {
                    yesVotes: vote.value === Vote.Yes ? voterBalance1 : 0,
                    noVotes: vote.value === Vote.No ? voterBalance1 : 0,
                    state: ProposalState.Pending,
                });

                await expect(myDao.connect(voter1).transfer(voter2.address, voterBalance1))
                    .to.not.emit(myDao, 'Voted');

                checkProposal(await myDao.proposals(proposalId), {
                    yesVotes: vote.value === Vote.Yes ? voterBalance1 : 0,
                    noVotes: vote.value === Vote.No ? voterBalance1 : 0,
                    state: ProposalState.Pending,
                });
            });
    });

    describe('Update proposal state', function() {
        itParam('One voter ${value.name} votes', [yes, no], async function(vote: VoteInfo) {
            const { myDao, owner, totalSupply } = await loadFixture(deployMyDaoFixture);
            const proposalId = 0;

            await myDao.connect(owner).createProposal(TEST_PROPOSAL_HASH);

            await expect(myDao.connect(owner).vote(proposalId, vote.value))
                .to.emit(myDao, 'Voted').withArgs(proposalId, owner.address, vote.value)
                .to.emit(myDao, vote.successEvent).withArgs(proposalId, TEST_PROPOSAL_HASH);

            checkProposal(await myDao.proposals(proposalId), {
                proposalHash: TEST_PROPOSAL_HASH,
                id: proposalId,
                yesVotes: vote.value === Vote.Yes ? totalSupply : 0,
                noVotes: vote.value === Vote.No ? totalSupply : 0,
                state: vote.successState,
            });
        });

        itParam('${value.successEvent} of third proposal with two pendings', [yes, no],
            async function(vote: VoteInfo) {
                const { myDao, owner, totalSupply } = await loadFixture(deployMyDaoFixture);
                const proposalId = 2;

                await myDao.connect(owner).createProposal(TEST_PROPOSAL_HASH);
                await myDao.connect(owner).createProposal(TEST_PROPOSAL_HASH);
                await myDao.connect(owner).createProposal(TEST_PROPOSAL_HASH);

                await expect(myDao.connect(owner).vote(proposalId, vote.value))
                    .to.emit(myDao, 'Voted').withArgs(proposalId, owner.address, vote.value)
                    .to.emit(myDao, vote.successEvent).withArgs(proposalId, TEST_PROPOSAL_HASH);

                checkProposal(await myDao.proposals(0), { state: ProposalState.Pending });
                checkProposal(await myDao.proposals(1), { state: ProposalState.Pending });
                checkProposal(await myDao.proposals(proposalId), {
                    proposalHash: TEST_PROPOSAL_HASH,
                    id: proposalId,
                    yesVotes: vote.value === Vote.Yes ? totalSupply : 0,
                    noVotes: vote.value === Vote.No ? totalSupply : 0,
                    state: vote.successState,
                });
            });

        itParam('${value.successEvent} with 2 ${value.name} votes of 3 voters', [yes, no], async function(vote: VoteInfo) {
            const { myDao, voters, balances } = await threeVotersFixture();

            const proposalHash = TEST_PROPOSAL_HASH;
            const proposalId = await myDao.proposalsCount();

            await myDao.connect(voters[0]).createProposal(proposalHash);
            const ttl = await time.latest() + VOTING_PERIOD;

            // Vote 0
            await expect(myDao.connect(voters[0]).vote(proposalId, vote.value))
                .to.emit(myDao, 'Voted').withArgs(proposalId, voters[0].address, vote.value);
            checkProposal(await myDao.proposals(proposalId), {
                proposalHash,
                id: proposalId,
                ttl: ttl,
                yesVotes: vote.value == Vote.Yes ? balances[0] : 0,
                noVotes: vote.value == Vote.No ? balances[0] : 0,
                state: ProposalState.Pending,
            });

            // Vote 1
            await expect(myDao.connect(voters[1]).vote(proposalId, vote.value))
                .to.emit(myDao, 'Voted').withArgs(proposalId, voters[1].address, vote.value)
                .to.emit(myDao, vote.successEvent).withArgs(proposalId, proposalHash);
            checkProposal(await myDao.proposals(proposalId), {
                proposalHash,
                id: proposalId,
                ttl: ttl,
                yesVotes: vote.value == Vote.Yes ? balances[0].add(balances[1]) : 0,
                noVotes: vote.value == Vote.No ? balances[0].add(balances[1]) : 0,
                state: vote.successState,
            });
        });

        itParam('${value[0].successEvent} with 2 ${value[0].name} and 1 ${value[1].name} votes of 3 voters',
            [[yes, no], [no, yes]],
            async function(vote: VoteInfo[]) {
                const { myDao, voters, balances } = await threeVotersFixture();

                const proposalHash = TEST_PROPOSAL_HASH;
                const proposalId = await myDao.proposalsCount();

                await myDao.connect(voters[0]).createProposal(proposalHash);
                const ttl = await time.latest() + VOTING_PERIOD;

                // Vote 0
                await expect(myDao.connect(voters[0]).vote(proposalId, vote[0].value))
                    .to.emit(myDao, 'Voted').withArgs(proposalId, voters[0].address, vote[0].value);
                checkProposal(await myDao.proposals(proposalId), {
                    proposalHash,
                    id: proposalId,
                    ttl: ttl,
                    yesVotes: vote[0].value == Vote.Yes ? balances[0] : 0,
                    noVotes: vote[0].value == Vote.No ? balances[0] : 0,
                    state: ProposalState.Pending,
                });

                // Vote 1
                await expect(myDao.connect(voters[1]).vote(proposalId, vote[1].value))
                    .to.emit(myDao, 'Voted').withArgs(proposalId, voters[1].address, vote[1].value);
                checkProposal(await myDao.proposals(proposalId), {
                    proposalHash,
                    id: proposalId,
                    ttl: ttl,
                    yesVotes: vote[0].value == Vote.Yes ? balances[0] : balances[1],
                    noVotes: vote[0].value == Vote.No ? balances[0] : balances[1],
                    state: ProposalState.Pending,
                });

                // Vote 2
                await expect(myDao.connect(voters[2]).vote(proposalId, vote[0].value))
                    .to.emit(myDao, 'Voted').withArgs(proposalId, voters[2].address, vote[0].value)
                    .to.emit(myDao, vote[0].successEvent).withArgs(proposalId, proposalHash);
                checkProposal(await myDao.proposals(proposalId), {
                    proposalHash,
                    id: proposalId,
                    ttl: ttl,
                    yesVotes: vote[0].value == Vote.Yes ? balances[0].add(balances[2]) : balances[1],
                    noVotes: vote[0].value == Vote.No ? balances[0].add(balances[2]) : balances[1],
                    state: vote[0].successState,
                });
            });

        itParam('${value.successEvent} by transfer tokens', [yes, no], async function(vote: VoteInfo) {
            const { myDao, voters, balances } = await threeVotersFixture();

            const proposalHash = TEST_PROPOSAL_HASH;
            const proposalId = await myDao.proposalsCount();

            await myDao.connect(voters[0]).createProposal(proposalHash);
            const ttl = await time.latest() + VOTING_PERIOD;

            // Vote 0
            await expect(myDao.connect(voters[0]).vote(proposalId, vote.value))
                .to.emit(myDao, 'Voted').withArgs(proposalId, voters[0].address, vote.value);
            checkProposal(await myDao.proposals(proposalId), {
                proposalHash,
                id: proposalId,
                ttl: ttl,
                yesVotes: vote.value == Vote.Yes ? balances[0] : 0,
                noVotes: vote.value == Vote.No ? balances[0] : 0,
                state: ProposalState.Pending,
            });

            // Transfer tokens
            await expect(myDao.connect(voters[1]).transfer(voters[0].address, balances[1]))
                .to.emit(myDao, vote.successEvent).withArgs(proposalId, proposalHash);
            checkProposal(await myDao.proposals(proposalId), {
                proposalHash,
                id: proposalId,
                ttl: ttl,
                yesVotes: vote.value == Vote.Yes ? balances[0].add(balances[1]) : 0,
                noVotes: vote.value == Vote.No ? balances[0].add(balances[1]) : 0,
                state: vote.successState,
            });
        });

        itParam('${value.successEvent} by vote with minimum balance', [yes, no], async function(vote: VoteInfo) {
            const { myDao, minimumBalanceAccount, halfSupplyAccount } = await minimumBalanceFixture();

            const proposalHash = TEST_PROPOSAL_HASH;
            const proposalId = 0;

            await myDao.connect(halfSupplyAccount).createProposal(proposalHash);

            await expect(myDao.connect(halfSupplyAccount).vote(proposalId, vote.value))
                .to.emit(myDao, 'Voted').withArgs(proposalId, halfSupplyAccount.address, vote.value)
                .to.not.emit(myDao, vote.successEvent);

            checkProposal(await myDao.proposals(proposalId), { state: ProposalState.Pending });

            await expect(myDao.connect(minimumBalanceAccount).vote(proposalId, vote.value))
                .to.emit(myDao, 'Voted').withArgs(proposalId, minimumBalanceAccount.address, vote.value)
                .to.emit(myDao, vote.successEvent).withArgs(proposalId, proposalHash);

            checkProposal(await myDao.proposals(proposalId), { state: vote.successState });
        });

        it('Replace expired proposal', async function() {
            const { myDao, owner } = await loadFixture(deployMyDaoFixture);

            const proposalHash0 = getProposalHash('Proposal 0');

            await myDao.connect(owner).createProposal(proposalHash0);

            await time.increase(VOTING_PERIOD + 1);

            checkProposal(await myDao.proposals(0), { state: ProposalState.Pending });

            const proposalHash1 = getProposalHash('Proposal 1');
            await expect(myDao.connect(owner).createProposal(proposalHash1))
                .to.emit(myDao, 'ProposalCreated').withArgs(1, proposalHash1, owner.address)
                .to.not.emit(myDao, 'ProposalExpired');
            checkProposal(await myDao.proposals(0), { state: ProposalState.Pending });

            const proposalHash2 = getProposalHash('Proposal 2');
            await expect(myDao.connect(owner).createProposal(proposalHash2))
                .to.emit(myDao, 'ProposalCreated').withArgs(2, proposalHash2, owner.address)
                .to.not.emit(myDao, 'ProposalExpired');
            checkProposal(await myDao.proposals(0), { state: ProposalState.Pending });

            const proposalHash3 = getProposalHash('Proposal 3');
            await expect(myDao.connect(owner).createProposal(proposalHash3))
                .to.emit(myDao, 'ProposalCreated').withArgs(3, proposalHash3, owner.address)
                .to.emit(myDao, 'ProposalExpired').withArgs(0, proposalHash0);
            checkProposal(await myDao.proposals(0), { state: ProposalState.Expired });
        });
    });
});