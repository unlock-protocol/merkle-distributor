import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { Contract, BigNumber, utils, constants } from 'ethers'

import BalanceTree from '../src/balance-tree'
import Distributor from '../build/MerkleDistributor.json'
import TestERC20 from '../build/TestERC20.json'
import { parseBalanceMap } from '../src/parse-balance-map'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
}


describe('MerkleDistributor', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })

  const wallets = provider.getWallets()
  const [wallet0, wallet1, wallet3] = wallets

  let token: Contract
  beforeEach('deploy token', async () => {
    token = await deployContract(wallet0, TestERC20, ['Token', 'TKN', 0], overrides)
  })

  describe('#token', () => {
    it('returns the token address', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, constants.HashZero, 1000, wallet3.address], overrides)
      expect(await distributor.token()).to.eq(token.address)
    })
  })

  describe('#merkleRoot', () => {
    it('returns the zero merkle root', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, constants.HashZero, 1000, wallet3.address], overrides)
      expect(await distributor.merkleRoot()).to.eq(constants.HashZero)
    })
  })

  describe('#claim', () => {
    it('fails for empty proof', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, constants.HashZero, 1000, wallet3.address], overrides)
      await expect(distributor.claim(0, wallet0.address, 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    it('fails for invalid index', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, constants.HashZero, 1000, wallet3.address], overrides)
      await expect(distributor.claim(0, wallet0.address, 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    describe('two account tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { account: wallet0.address, amount: BigNumber.from(100) },
          { account: wallet1.address, amount: BigNumber.from(101) },
        ])
        distributor = await deployContract(wallet0, Distributor, [token.address, tree.getHexRoot(), 1000, wallet3.address], overrides)
        await token.setBalance(distributor.address, 201)
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, wallet0.address, 100)
        const proof1 = tree.getProof(1, wallet1.address, BigNumber.from(101))
        await expect(distributor.claim(1, wallet1.address, 101, proof1, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(1, wallet1.address, 101)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        expect(await token.balanceOf(wallet0.address)).to.eq(0)
        await distributor.claim(0, wallet0.address, 100, proof0, overrides)
        expect(await token.balanceOf(wallet0.address)).to.eq(100)
      })

      it('must have enough to transfer', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await token.setBalance(distributor.address, 99)
        await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides)).to.be.revertedWith(
          'ERC20: transfer amount exceeds balance'
        )
      })

      it('sets #isClaimed', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        expect(await distributor.isClaimed(0)).to.eq(false)
        expect(await distributor.isClaimed(1)).to.eq(false)
        await distributor.claim(0, wallet0.address, 100, proof0, overrides)
        expect(await distributor.isClaimed(0)).to.eq(true)
        expect(await distributor.isClaimed(1)).to.eq(false)
      })

      it('cannot allow two claims', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await distributor.claim(0, wallet0.address, 100, proof0, overrides)
        await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      })

      it('cannot claim more than once: 0 and then 1', async () => {
        await distributor.claim(
          0,
          wallet0.address,
          100,
          tree.getProof(0, wallet0.address, BigNumber.from(100)),
          overrides
        )
        await distributor.claim(
          1,
          wallet1.address,
          101,
          tree.getProof(1, wallet1.address, BigNumber.from(101)),
          overrides
        )

        await expect(
          distributor.claim(0, wallet0.address, 100, tree.getProof(0, wallet0.address, BigNumber.from(100)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim more than once: 1 and then 0', async () => {
        await distributor.claim(
          1,
          wallet1.address,
          101,
          tree.getProof(1, wallet1.address, BigNumber.from(101)),
          overrides
        )
        await distributor.claim(
          0,
          wallet0.address,
          100,
          tree.getProof(0, wallet0.address, BigNumber.from(100)),
          overrides
        )

        await expect(
          distributor.claim(1, wallet1.address, 101, tree.getProof(1, wallet1.address, BigNumber.from(101)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim for address other than proof', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(distributor.claim(1, wallet1.address, 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('cannot claim more than proof', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(distributor.claim(0, wallet0.address, 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('gas', async () => {
        const proof = tree.getProof(0, wallet0.address, BigNumber.from(100))
        const tx = await distributor.claim(0, wallet0.address, 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(81263)
      })
    })

    describe('larger tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree(
          wallets.map((wallet, ix) => {
            return { account: wallet.address, amount: BigNumber.from(ix + 1) }
          })
        )
        distributor = await deployContract(wallet0, Distributor, [token.address, tree.getHexRoot(), 1000, wallet3.address], overrides)
        await token.setBalance(distributor.address, 201)
      })

      it('claim index 4', async () => {
        const proof = tree.getProof(4, wallets[4].address, BigNumber.from(5))
        await expect(distributor.claim(4, wallets[4].address, 5, proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(4, wallets[4].address, 5)
      })

      it('claim index 9', async () => {
        const proof = tree.getProof(9, wallets[9].address, BigNumber.from(10))
        await expect(distributor.claim(9, wallets[9].address, 10, proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(9, wallets[9].address, 10)
      })

      it('gas', async () => {
        const proof = tree.getProof(9, wallets[9].address, BigNumber.from(10))
        const tx = await distributor.claim(9, wallets[9].address, 10, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(84042)
      })

      it('gas second down about 15k', async () => {
        await distributor.claim(
          0,
          wallets[0].address,
          1,
          tree.getProof(0, wallets[0].address, BigNumber.from(1)),
          overrides
        )
        const tx = await distributor.claim(
          1,
          wallets[1].address,
          2,
          tree.getProof(1, wallets[1].address, BigNumber.from(2)),
          overrides
        )
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(69022)
      })
    })

    describe('realistic size tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      const NUM_LEAVES = 100_000
      const NUM_SAMPLES = 25
      const elements: { account: string; amount: BigNumber }[] = []
      for (let i = 0; i < NUM_LEAVES; i++) {
        const node = { account: wallet0.address, amount: BigNumber.from(100) }
        elements.push(node)
      }
      tree = new BalanceTree(elements)

      it('proof verification works', () => {
        const root = Buffer.from(tree.getHexRoot().slice(2), 'hex')
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree
            .getProof(i, wallet0.address, BigNumber.from(100))
            .map((el) => Buffer.from(el.slice(2), 'hex'))
          const validProof = BalanceTree.verifyProof(i, wallet0.address, BigNumber.from(100), proof, root)
          expect(validProof).to.be.true
        }
      })

      beforeEach('deploy', async () => {
        distributor = await deployContract(wallet0, Distributor, [token.address, tree.getHexRoot(), 1000, wallet3.address], overrides)
        await token.setBalance(distributor.address, BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) // max uint224 (as https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/extensions/ERC20Votes.sol#L166)
      })

      it('gas', async () => {
        const proof = tree.getProof(50000, wallet0.address, BigNumber.from(100))
        const tx = await distributor.claim(50000, wallet0.address, 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(95967)
      })

      it('gas deeper node', async () => {
        const proof = tree.getProof(90000, wallet0.address, BigNumber.from(100))
        const tx = await distributor.claim(90000, wallet0.address, 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(95903)
      })

      it('gas average random distribution', async () => {
        let total: BigNumber = BigNumber.from(0)
        let count: number = 0
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100))
          const tx = await distributor.claim(i, wallet0.address, 100, proof, overrides)
          const receipt = await tx.wait()
          total = total.add(receipt.gasUsed)
          count++
        }
        const average = total.div(count)
        expect(average).to.eq(81373)
      })

      // this is what we gas golfed by packing the bitmap
      it('gas average first 25', async () => {
        let total: BigNumber = BigNumber.from(0)
        let count: number = 0
        for (let i = 0; i < 25; i++) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100))
          const tx = await distributor.claim(i, wallet0.address, 100, proof, overrides)
          const receipt = await tx.wait()
          total = total.add(receipt.gasUsed)
          count++
        }
        const average = total.div(count)
        expect(average).to.eq(67141)
      })

      it('no double claims in random distribution', async () => {
        for (let i = 0; i < 25; i += Math.floor(Math.random() * (NUM_LEAVES / NUM_SAMPLES))) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100))
          await distributor.claim(i, wallet0.address, 100, proof, overrides)
          await expect(distributor.claim(i, wallet0.address, 100, proof, overrides)).to.be.revertedWith(
            'MerkleDistributor: Drop already claimed.'
          )
        }
      })
    })

    describe('delegation', () => {
      let distributor: Contract
      let tree: BalanceTree
      const version = '1';

      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { account: wallet0.address, amount: BigNumber.from(100) },
          { account: wallet1.address, amount: BigNumber.from(101) },
        ])
        distributor = await deployContract(wallet0, Distributor, [token.address, tree.getHexRoot(), 1000, wallet3.address], overrides)
        await token.setBalance(distributor.address, 201)
      })

      it('successful delegation before claim', async () => {
        expect(await token.delegates(wallet0.address)).to.be.equal(constants.AddressZero);
        await expect(token.delegate(wallet0.address))
          .to.emit(token, 'DelegateChanged')
          .withArgs(wallet0.address, constants.AddressZero, wallet0.address)

        expect(await token.delegates(wallet0.address)).to.be.equal(wallet0.address);

        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, wallet0.address, 100)

          expect(await token.delegates(wallet0.address)).to.be.equal(wallet0.address);

      })

      it('successful delegation after claim', async () => {
        expect(await token.delegates(wallet0.address)).to.be.equal(constants.AddressZero);
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))

        await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, wallet0.address, 100)

          await expect(token.delegate(wallet0.address))
          .to.emit(token, 'DelegateChanged')
          .withArgs(wallet0.address, constants.AddressZero, wallet0.address)
          .to.emit(token, 'DelegateVotesChanged')
          .withArgs(wallet0.address, BigNumber.from(0), BigNumber.from(100))
          expect (await token.balanceOf(wallet0.address)).to.eq(100)

        expect(await token.delegates(wallet0.address)).to.be.equal(wallet0.address);
      })

      it('successful self delegation by signature after claim', async () => {

        // Not delegated
        expect(await token.delegates(wallet0.address)).to.be.equal(constants.AddressZero);
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))

        // claim
        await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, wallet0.address, 100)

        // check balance
        expect (await token.balanceOf(wallet0.address)).to.eq(100)

        // Still not delegated
        expect(await token.delegates(wallet0.address)).to.be.equal(constants.AddressZero);

        const delegatee = wallet0.address

        // Prep sign
        const nonce = 0
        const expiry = Math.floor(new Date().getTime()/1000) + 60 * 60 // 1 hour from now!
        // const { chainId } = await provider.getNetwork()
        const chainId = 1 // Ganache things its #1. 🤦‍♂️
        const domain = {
          name: await token.name(),
          version,
          chainId,
          verifyingContract: token.address,
        }

        const types = {
          'Delegation': [
            { name: 'delegatee', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'expiry', type: 'uint256' },
          ]
        }

        const value = {
          delegatee,
          nonce,
          expiry,
        }

        // Sign with ethers
        const ethersSignature = await wallet0._signTypedData(domain, types, value)
        expect(utils.verifyTypedData(domain, types, value, ethersSignature)).to.equal(wallet0.address)


        const signer = utils.verifyTypedData(domain, types, value, ethersSignature)
        expect(utils.verifyTypedData(domain, types, value, ethersSignature)).to.equal(wallet0.address)

        // Format signature
        const { v, r, s } = utils.splitSignature(ethersSignature)

        await expect(token.delegateBySig(delegatee, nonce, expiry, v, r, s))
          .to.emit(token, 'DelegateChanged')
          .withArgs(wallet0.address, constants.AddressZero, wallet0.address)
          .to.emit(token, 'DelegateVotesChanged')
          .withArgs(wallet0.address, BigNumber.from(0), BigNumber.from(100))

        expect(await token.delegates(wallet0.address)).to.be.equal(wallet0.address);
      })
    })

  })

  describe('#delegateToClaim', () => {

      let distributor: Contract
      let tree: BalanceTree

      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { account: wallet0.address, amount: BigNumber.from(100) },
          { account: wallet1.address, amount: BigNumber.from(101) },
        ])
        distributor = await deployContract(wallet0, Distributor, [token.address, tree.getHexRoot(), 1000, wallet3.address], overrides)
        await token.setBalance(distributor.address, 201)
      })

      it('successful claim and delegate to self', async () => {

        // Not delegated
        expect(await token.delegates(wallet0.address)).to.be.equal(constants.AddressZero);

        // Create Proof
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        const version = '1';

        const delegatee = wallet0.address

        // Prep sign
        const nonce = 0
        const expiry = Math.floor(new Date().getTime()/1000) + 60 * 60 // 1 hour from now!
        // const { chainId } = await provider.getNetwork()
        const chainId = 1 // Ganache things its #1. 🤦‍♂️
        const domain = {
          name: await token.name(),
          version,
          chainId,
          verifyingContract: token.address,
        }

        const types = {
          'Delegation': [
            { name: 'delegatee', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'expiry', type: 'uint256' },
          ]
        }

        const value = {
          delegatee,
          nonce,
          expiry,
        }

        // Sign with ethers
        const ethersSignature = await wallet0._signTypedData(domain, types, value)
        expect(utils.verifyTypedData(domain, types, value, ethersSignature)).to.equal(wallet0.address)

        // Format signature
        const { v, r, s } = utils.splitSignature(ethersSignature)

        await expect(distributor.delegateToClaim(delegatee, nonce, expiry, v, r, s, 0, wallet0.address, 100, proof0, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, wallet0.address, 100)
          .to.emit(token, 'DelegateChanged')
          .withArgs(wallet0.address, constants.AddressZero, wallet0.address)
          .to.emit(token, 'DelegateVotesChanged')
          .withArgs(wallet0.address, BigNumber.from(0), BigNumber.from(100))

          expect(await token.delegates(wallet0.address)).to.be.equal(wallet0.address);
          expect(await token.balanceOf(wallet0.address)).to.be.equal(100);
      })

      it('successful claim and delegate to someone else', async () => {

        // Not delegated
        expect(await token.delegates(wallet0.address)).to.be.equal(constants.AddressZero);

        // Create Proof
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        const version = '1';

        const delegatee = wallet1.address

        // Prep sign
        const nonce = 0
        const expiry = Math.floor(new Date().getTime()/1000) + 60 * 60 // 1 hour from now!
        // const { chainId } = await provider.getNetwork()
        const chainId = 1 // Ganache things its #1. 🤦‍♂️
        const domain = {
          name: await token.name(),
          version,
          chainId,
          verifyingContract: token.address,
        }

        const types = {
          'Delegation': [
            { name: 'delegatee', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'expiry', type: 'uint256' },
          ]
        }

        const value = {
          delegatee,
          nonce,
          expiry,
        }

        // Sign with ethers
        const ethersSignature = await wallet0._signTypedData(domain, types, value)
        expect(utils.verifyTypedData(domain, types, value, ethersSignature)).to.equal(wallet0.address)

        // Format signature
        const { v, r, s } = utils.splitSignature(ethersSignature)

        await expect(distributor.delegateToClaim(delegatee, nonce, expiry, v, r, s, 0, wallet0.address, 100, proof0, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, wallet0.address, 100)
          .to.emit(token, 'DelegateChanged')
          .withArgs(wallet0.address, constants.AddressZero, wallet1.address)
          .to.emit(token, 'DelegateVotesChanged')
          .withArgs(wallet1.address, BigNumber.from(0), BigNumber.from(100))

          expect(await token.delegates(wallet0.address)).to.be.equal(wallet1.address);
          expect(await token.delegates(wallet1.address)).to.be.equal(constants.AddressZero);
          expect(await token.balanceOf(wallet0.address)).to.be.equal(100);
          expect(await token.balanceOf(wallet1.address)).to.be.equal(0);
      })

      it('gas', async () => {
        const proof = tree.getProof(0, wallet0.address, BigNumber.from(100))

        const delegatee = wallet0.address

        // Prep sign
        const version = '1';
        const nonce = 0
        const expiry = Math.floor(new Date().getTime()/1000) + 60 * 60 // 1 hour from now!
        // const { chainId } = await provider.getNetwork()
        const chainId = 1 // Ganache things its #1. 🤦‍♂️
        const domain = {
          name: await token.name(),
          version,
          chainId,
          verifyingContract: token.address,
        }

        const types = {
          'Delegation': [
            { name: 'delegatee', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'expiry', type: 'uint256' },
          ]
        }

        const value = {
          delegatee,
          nonce,
          expiry,
        }

        // Sign with ethers
        const ethersSignature = await wallet0._signTypedData(domain, types, value)
        expect(utils.verifyTypedData(domain, types, value, ethersSignature)).to.equal(wallet0.address)

        // Format signature
        const { v, r, s } = utils.splitSignature(ethersSignature)

        const tx = await distributor.delegateToClaim(delegatee, nonce, expiry, v, r, s, 0, wallet0.address, 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(184780)
      })
  })


  describe('parseBalanceMap', () => {
    let distributor: Contract
    let claims: {
      [account: string]: {
        index: number
        amount: string
        proof: string[]
      }
    }
    beforeEach('deploy', async () => {
      const { claims: innerClaims, merkleRoot, tokenTotal } = parseBalanceMap({
        [wallet0.address]: 200,
        [wallet1.address]: 300,
        [wallets[2].address]: 250,
      })
      expect(tokenTotal).to.eq('0x02ee') // 750
      claims = innerClaims
      distributor = await deployContract(wallet0, Distributor, [token.address, merkleRoot, 1000, wallet3.address], overrides)
      await token.setBalance(distributor.address, tokenTotal)
    })

    it('check the proofs is as expected', () => {
      expect(claims).to.deep.eq({
        [wallet0.address]: {
          index: 0,
          amount: '0xc8',
          proof: ['0x2a411ed78501edb696adca9e41e78d8256b61cfac45612fa0434d7cf87d916c6'],
        },
        [wallet1.address]: {
          index: 1,
          amount: '0x012c',
          proof: [
            '0xbfeb956a3b705056020a3b64c540bff700c0f6c96c55c0a5fcab57124cb36f7b',
            '0xd31de46890d4a77baeebddbd77bf73b5c626397b73ee8c69b51efe4c9a5a72fa',
          ],
        },
        [wallets[2].address]: {
          index: 2,
          amount: '0xfa',
          proof: [
            '0xceaacce7533111e902cc548e961d77b23a4d8cd073c6b68ccf55c62bd47fc36b',
            '0xd31de46890d4a77baeebddbd77bf73b5c626397b73ee8c69b51efe4c9a5a72fa',
          ],
        },
      })
    })

    it('all claims work exactly once', async () => {
      for (let account in claims) {
        const claim = claims[account]
        await expect(distributor.claim(claim.index, account, claim.amount, claim.proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(claim.index, account, claim.amount)
        await expect(distributor.claim(claim.index, account, claim.amount, claim.proof, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      }
      expect(await token.balanceOf(distributor.address)).to.eq(0)
    })
  })

  describe('sweep', () => {
    let distributor: Contract
    let tree: BalanceTree
    let dropDuration = 10;
    beforeEach('deploy', async () => {
      tree = new BalanceTree([
        { account: wallet0.address, amount: BigNumber.from(100) },
        { account: wallet1.address, amount: BigNumber.from(101) },
      ])
      distributor = await deployContract(wallet0, Distributor, [token.address, tree.getHexRoot(), dropDuration, wallet3.address], overrides)
      await token.setBalance(distributor.address, 201)
    })

    it('should not transfer any funds if drop is still active', async () => {
      expect(await token.balanceOf(distributor.address)).to.equal(201)
      expect(await token.balanceOf(wallet3.address)).to.equal(0)
      await expect(distributor.sweep()).to.be.revertedWith('Drop has not ended yet');
      expect(await token.balanceOf(distributor.address)).to.equal(201)
      expect(await token.balanceOf(wallet3.address)).to.equal(0)
    })

    it('should transfer all funds when time is expired', async () => {
      expect(await token.balanceOf(distributor.address)).to.equal(201)
      expect(await token.balanceOf(wallet3.address)).to.equal(0)

      const currentBlock = await provider.getBlockNumber()
      const startingBlock = (await distributor.startingBlock()).toNumber()
      const maxBlocks = (await distributor.maxBlocks()).toNumber()
      expect(maxBlocks).to.equal(dropDuration)

      // Mine empty blocks
      const blocksToWait = maxBlocks - currentBlock + startingBlock
      for (var i = 0 ; i < blocksToWait; i++) {
        await provider.send("evm_mine", [])
      }
      await distributor.sweep()
      expect(await token.balanceOf(distributor.address)).to.equal(0)
      expect(await token.balanceOf(wallet3.address)).to.equal(201)
    })


    it('should fail any claim after sweep', async () => {
      const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
      await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides))
        .to.emit(distributor, 'Claimed')
        .withArgs(0, wallet0.address, 100)


      const currentBlock = await provider.getBlockNumber()
      const startingBlock = (await distributor.startingBlock()).toNumber()
      const maxBlocks = (await distributor.maxBlocks()).toNumber()

      // Mine empty blocks
      const blocksToWait = maxBlocks - currentBlock + startingBlock
      for (var i = 0 ; i < blocksToWait; i++) {
        await provider.send("evm_mine", [])
      }
      await distributor.sweep()

      const proof1 = tree.getProof(1, wallet1.address, BigNumber.from(101))
      await expect(distributor.claim(1, wallet1.address, 101, proof1, overrides))
        .to.be.revertedWith('ERC20: transfer amount exceeds balance');
    })
  })

})
