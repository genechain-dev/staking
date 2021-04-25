import 'bootstrap/js/dist/modal'
import 'bootstrap/js/dist/popover'
import bootbox from 'bootbox'
import 'backbone'
import _ from 'underscore'
import MetaMaskOnboarding from '@metamask/onboarding'
import { riboseContractAddr, riboseAbi } from './constants.json'
import { Web3Provider } from '@ethersproject/providers'
import { Contract } from '@ethersproject/contracts'
import { formatEther, parseEther } from '@ethersproject/units'
import { WeiPerEther } from '@ethersproject/constants'

const geneChainId = 8080
const rewardPerBlock = 2
const rewardPerDay = rewardPerBlock * 28800
const rewardPerYear = rewardPerDay * 365

const currentUrl = new URL(window.location.href)
const forwarderOrigin = currentUrl.hostname === 'localhost' ? 'http://localhost:9010' : undefined

const { isMetaMaskInstalled } = MetaMaskOnboarding

let onboarding
let accounts

const initialize = async () => {
  try {
    onboarding = new MetaMaskOnboarding({ forwarderOrigin })
  } catch (error) {
    console.error(error)
  }
  checkNetwork()
}
window.addEventListener('DOMContentLoaded', initialize)

function alertError() {
  var message,
    title = ''
  if (arguments.length > 1) {
    title = '<h5 class="alert-heading">' + arguments[0] + '</h5>'
    message = arguments[1]
  } else {
    message = arguments[0]
  }
  message = '<div class="alert alert-danger" role="alert">' + title + '<samp class="small">' + message + '</samp></div>'
  bootbox.alert({ message: message, backdrop: true, closeButton: false })
}

const checkNetwork = async () => {
  if (!isMetaMaskInstalled()) {
    $('#installButton').on('click', onClickInstall).prop('hidden', false)
    return
  }

  const chainId = await ethereum.request({ method: 'eth_chainId' })
  onChainIdChanged(chainId)

  ethereum.on('chainChanged', onChainIdChanged)
  ethereum.on('accountsChanged', onAccountsChanged)
}

const onClickInstall = () => {
  $('#installButton').prop('innerText', 'Waiting for installation').prop('disabled', true)
  onboarding.startOnboarding()
}

const onClickConnect = async () => {
  try {
    $('#connectButton').prop('innerText', 'Waiting for connect').prop('disabled', true)
    const newAccounts = await ethereum.request({
      method: 'eth_requestAccounts'
    })
    handleNewAccounts(newAccounts)
  } catch (error) {
    console.error(error)
  }
}

const handleNewAccounts = async (newAccounts) => {
  accounts = newAccounts
  var account = accounts[0]
  var bal = await ethereum.request({
    method: 'eth_getBalance',
    params: [account]
  })
  var accountDetail = $('#accountDetail')
  accountDetail.prop('hidden', false)
  accountDetail.find('#address').prop('innerText', account.substr(0, 6) + '...' + account.substr(account.length - 4, 4))
  accountDetail.find('#balance').prop('innerText', formatEther(bal))
  // @todo check profitBook
  // console.log(keccak256)
  // console.log('0x' + keccak256("profitBook").substring(0, 8) + account)
  // var profit = await ethereum.request({
  //     method: 'eth_call',
  //     params: [{
  //         to: riboseContractAddr,
  //         data: '0x' + keccak256("profitBook").substring(0, 8) + account
  //     }, "latest"]
  // })
  // accountDetail.find("#profit").prop("innerText", formatEther(profit))
  if (onboarding) {
    onboarding.stopOnboarding()
  }
  reloadValidators()
}

const onChainIdChanged = async (chainId) => {
  if (chainId != geneChainId) {
    $('#wrongNetwork').modal()
    return
  }
  $('#wrongNetwork').modal('hide')

  accounts = await ethereum.request({ method: 'eth_requestAccounts' })

  const isMetaMaskConnected = () => accounts && accounts.length > 0
  console.debug(accounts)

  if (isMetaMaskConnected()) {
    handleNewAccounts(accounts)
  } else {
    $('#connectButton').on('click', onClickConnect).prop('hidden', false)
  }
}

const onAccountsChanged = async (accounts) => {
  handleNewAccounts(accounts)
}

$('#addNetwork').on('click', async () => {
  console.log(1)
  await ethereum.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: '0x' + geneChainId.toString(16),
        chainName: 'GeneChain Adenine Testnet',
        nativeCurrency: { name: 'RNA', symbol: 'RNA', decimals: 18 },
        rpcUrls: ['https://rpc-testnet.genechain.io'],
        blockExplorerUrls: ['https://scan-testnet.genechain.io/']
      }
    ]
  })
})

// validator list
let CandidateView = Backbone.View.extend({
  tagName: 'tr',
  attributes: { class: 'small' },
  template: _.template($('#candidate-template').html()),

  initialize: function () {
    this.listenTo(this.model, 'change', this.render)
  },

  render: function () {
    this.model.set('id', this.model.collection.indexOf(this.model) + 1)
    this.$el.html(this.template(this.model.toJSON()))
    this.$el.find('#stake').on('click', this.model, stakeDialog.onStakeCliked)
    if (!this.model.get('staked')) this.$el.find('#unstake').remove()
    this.$el.find('[data-toggle="popover"]').popover({ trigger: 'focus' })
    this.$el.find('[data-toggle="tooltip"]').tooltip()
    return this
  }
})

let CandidatesView = Backbone.View.extend({
  el: $('#topCandidates > table'),
  initialize: function () {
    this.listenTo(this.model, 'update', this.render)
    this.listenTo(this.model, 'reset', this.render)
  },

  render: function () {
    var $tbody = this.$('tbody')
    $tbody.empty()
    _.each(
      this.model.models,
      function (data) {
        this.$el.append(new CandidateView({ model: data }).render().el)
      },
      this
    )
    return this
  }
})

let StakedCandidateView = CandidateView.extend({
  template: _.template($('#staked-template').html())
})

let StakedCandidatesView = CandidatesView.extend({
  el: $('#stakedCandidates > table'),

  render: function () {
    var $tbody = this.$('tbody')
    $tbody.empty()
    _.each(
      this.model.models,
      function (data) {
        this.$el.append(new StakedCandidateView({ model: data }).render().el)
      },
      this
    )
    return this
  }
})

let Candidate = Backbone.Model.extend({
  defaults: {
    ready: false,
    validator: '',
    active: false,
    power: 0,
    apy: 0,
    rewardPerDay: 0,
    stakerShare: 0,
    stakePower: 0,
    stakeRNA: 0,
    stakeARM: 0,
    profitValue: 0,
    staked: false
  }
})

let Candidates = Backbone.Collection.extend({
  model: Candidate,
  comparator: function (item) {
    return -item.get('power')
  }
})

let StakedCandidate = Candidate.extend({
  defaults: {
    ready: false,
    validator: '',
    active: false,
    power: 0,
    apy: 0,
    rewardPerDay: 0,
    stakerShare: 0,
    stakePower: 0,
    stakeRNA: 0,
    stakeARM: 0,
    profitValue: 0,
    staked: true,
    stakedRNA: 0,
    stakedARM: 0,
    stakedPower: 0,
    bookAtValue: 0,
    lockBlock: 0,
    profit: 0
  }
})

let StakedCandidates = Backbone.Collection.extend({
  model: StakedCandidate,
  comparator: function (item) {
    return -item.get('power')
  }
})

let top = new Candidates()
new CandidatesView({ model: top }).render()
let staked = new StakedCandidates()
new StakedCandidatesView({ model: staked }).render()

const reloadValidators = async () => {
  top.reset()
  staked.reset()
  $('#topCandidates').find('.spinner-border').prop('hidden', false)
  $('#stakedCandidates').find('.spinner-border').prop('hidden', false)

  var ethersProvider = new Web3Provider(window.ethereum, 'any')
  var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider)

  var stakedCandidates = await riboseContract.getStakedCandidates(accounts[0])
  console.debug('staked candidates', stakedCandidates)
  if (stakedCandidates.length > 0) {
    stakedCandidates.forEach(function (addr, index) {
      staked.add(
        new StakedCandidate({
          validator: addr,
          staked: true
        })
      )
    })
    $('#stakedCandidates').find('.spinner-border').prop('hidden', true)
  }
  $('#stakedCandidates').prop('hidden', stakedCandidates.length == 0)

  var topCandidates = await riboseContract.getTopCandidates()
  console.debug('top candidates', topCandidates)
  topCandidates[0].forEach(function (addr, index) {
    var v = new Candidate({
      validator: addr,
      power: topCandidates[1][index]
    })
    top.add(v)
    if (stakedCandidates.indexOf(addr) >= 0) {
      v.set({ staked: true })
      var s = staked.findWhere({ validator: addr })
      if (s) s.set({ power: topCandidates[1][index] })
    }
  })
  // top.sort()
  $('#topCandidates').find('.spinner-border').prop('hidden', true)

  var validators = await riboseContract.getValidators()
  console.debug('validators', validators)
  validators.forEach((addr, index) => {
    var t = top.findWhere({ validator: addr })
    if (t) t.set({ active: true })
    var s = staked.findWhere({ validator: addr })
    if (s) s.set({ active: true })
  })

  for (var candidate of staked) {
    var info = await riboseContract.getCandidateStakeInfo(candidate.get('validator'))
    console.debug('candidate info', candidate.get('validator'), info)
    candidate.set({
      stakerShare: info[0],
      stakePower: info[1],
      stakeRNA: formatEther(info[2]),
      stakeARM: formatEther(info[3]),
      profitValue: formatEther(info[4]),
      rewardPerDay: rewardPerDay / validators.length,
      apy: (rewardPerYear * 100) / validators.length / (info[2] == 0 ? 1 : info[2].div(WeiPerEther))
    })
    var info = await riboseContract.getStakingInfo(candidate.get('validator'), accounts[0])
    console.debug('staker info', candidate.get('validator'), accounts[0], info)
    candidate.set({
      stakedRNA: formatEther(info[0]),
      stakedARM: formatEther(info[1]),
      stakedPower: info[2],
      bookAtValue: info[3],
      lockBlock: info[4]
    })
    var profit = await riboseContract.getStakerUnsettledProfit(candidate.get('validator'), accounts[0])
    candidate.set({ profit: formatEther(profit), ready: true })
  }

  for (var candidate of top) {
    var s = staked.findWhere({ validator: candidate.get('validator') })
    if (s) {
      candidate.set({
        stakerShare: s.get('stakerShare'),
        stakePower: s.get('stakePower'),
        stakeRNA: s.get('stakeRNA'),
        stakeARM: s.get('stakeARM'),
        profitValue: s.get('profitValue'),
        rewardPerDay: s.get('rewardPerDay'),
        apy: s.get('apy'),
        ready: true
      })
      continue
    }
    var info = await riboseContract.getCandidateStakeInfo(candidate.get('validator'))
    console.debug('candidate info', info)
    candidate.set({
      stakerShare: info[0],
      stakePower: info[1],
      stakeRNA: formatEther(info[2]),
      stakeARM: formatEther(info[3]),
      profitValue: formatEther(info[4]),
      rewardPerDay: rewardPerDay / validators.length,
      apy: (rewardPerYear * 100) / validators.length / (info[2] == 0 ? 1 : info[2].div(WeiPerEther)),
      ready: true
    })
  }
}

// Stake dialog
var stakeDialog = {
  view: Backbone.View.extend({
    el: '#stakeDialog',
    template: _.template($('#stake-template').html()),

    show: function () {
      this.$el.modal()
    },

    submit: async function (event) {
      var form = this.$('form')
      var rna = 0,
        arm = 0
      try {
        if (form.find('#rna').val().length > 0) rna = parseEther(form.find('#rna').val())
        if (form.find('#arm').val().length > 0) arm = parseEther(form.find('#arm').val())
      } catch (error) {
        console.error(error)
        alertError('Unexpect Error', error.message)
        return
      }
      if (arm == 0) {
        if (rna == 0) {
          alertError('You should stake at least 1 RNA or 3 ARMs')
          return
        }
      } else if (arm < parseEther('3')) {
        alertError('ARM should be at least 3')
        return
      }
      this.$('#confirm').prop('disabled', true).find('.spinner-border').prop('hidden', false)
      var ethersProvider = new Web3Provider(window.ethereum, 'any')
      var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider.getSigner())
      riboseContract
        .stake(this.model.get('validator'), arm, { value: rna })
        .then((result) => {
          console.debug(result)
          result
            .wait()
            .then((receipt) => {
              console.debug(receipt)
              if (receipt.status != 1) {
                alertError('Transaction failed, hash ' + receipt.transactionHash + '')
              } else {
                bootbox.alert('Stake suceeded', reloadValidators)
                $('#stakeDialog').modal('hide')
              }
            })
            .catch((error) => {
              console.error(error)
              alertError(JSON.stringify(error, Object.getOwnPropertyNames(error)))
            })
        })
        .catch((error) => {
          console.error(error)
          alertError(JSON.stringify(error, Object.getOwnPropertyNames(error)))
        })
        .finally(
          function () {
            this.$('#confirm').prop('disabled', false).find('.spinner-border').prop('hidden', true)
          }.bind(this)
        )
    },

    render: function () {
      this.$('form').html(this.template(this.model.toJSON()))
      this.$('#confirm').off('click')
      this.$('#confirm').on('click', this.submit.bind(this))
      return this
    }
  }),

  onStakeCliked: function (event) {
    var candidate = event.data
    new stakeDialog.view({ model: candidate }).render().show()
  }
}
