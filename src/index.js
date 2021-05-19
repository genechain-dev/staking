import 'bootstrap/js/dist/modal'
import 'bootstrap/js/dist/popover'
import 'bootstrap/js/dist/toast'
import 'backbone'
import _ from 'underscore'
import MetaMaskOnboarding from '@metamask/onboarding'
import { armContractAddr, armAbi, riboseContractAddr, riboseAbi, vbcAbi } from './constants.json'
import { Web3Provider } from '@ethersproject/providers'
import { Contract } from '@ethersproject/contracts'
import { formatEther, parseEther } from '@ethersproject/units'
import { Zero, WeiPerEther } from '@ethersproject/constants'
import { BigNumber } from '@ethersproject/bignumber'
import * as Sentry from '@sentry/browser'
import { Integrations } from '@sentry/tracing'

Sentry.init({
  dsn: 'https://e3954ef02f76484a86a18d2883699851@o687555.ingest.sentry.io/5773078',
  integrations: [new Integrations.BrowserTracing()],
  release: '0.0.5',

  // Set tracesSampleRate to 1.0 to capture 100%
  // of transactions for performance monitoring.
  // We recommend adjusting this value in production
  tracesSampleRate: 0.01
})

const geneChainIds = [
  { id: 80, name: 'Main genenet', testnet: false },
  { id: 8080, name: 'Adenine TESTNET', testnet: true },
  { id: 18080, name: 'Cytosine TESTNET', testnet: true }
]
const rewardPerBlock = 2
const rewardShare = 0.9
const rewardPerDay = rewardPerBlock * rewardShare * 28800
const rewardPerYear = rewardPerDay * 365

const { isMetaMaskInstalled } = MetaMaskOnboarding

let onboarding
let accounts // Connected accounts
let validators // Active validators
let accountData = {
  address: '',
  balance: Zero,
  balanceARM: Zero,
  balanceVBC: Zero,
  profit: Zero,
  formatEther: formatEther
}
let networkData = { chainId: 0, lastBlock: 0 } //network data
let subscriptions = { newBlock: 0 }

const initialize = () => {
  try {
    onboarding = new MetaMaskOnboarding()
  } catch (error) {
    console.error(error)
    Sentry.captureException(error)
  }
  try {
    checkNetwork()
  } catch (error) {
    console.error(error)
    Sentry.captureException(error)
  }
}
window.addEventListener('DOMContentLoaded', initialize)

function alertModal(params) {
  var data = _.extend(
    {
      title: '',
      titleClasses: '',
      closeButton: true,
      buttons: '',
      message: '',
      bodyClasses: '',
      footClasses: ''
    },
    typeof params === 'string' || params instanceof String ? { message: params } : params
  )
  console.debug('modal', data)
  return $(_.template($('#modal-template').html())(data))
    .appendTo('body')
    .modal(data)
    .modal('show')
    .on('hidden.bs.modal', function (data) {
      data.currentTarget.remove()
    })
}

function captureWeb3Error(error) {
  console.error(
    error,
    'code',
    error.code,
    'data',
    error.data ? JSON.stringify(error.data, Object.getOwnPropertyNames(error.data)) : '-'
  )
  var err = new Error(error.message)
  err.stack = error.stack
  Sentry.captureException(err)
}

function alertError(params) {
  var data = _.extend(
    { message: '', error: '' },
    typeof params === 'string' || params instanceof String ? { title: 'Error', message: params } : params
  )
  if (data.error) {
    captureWeb3Error(data.error)
    if (data.error.data)
      data.error.details = JSON.stringify(data.error.data, Object.getOwnPropertyNames(data.error.data))
  }
  _.extend(data, { message: _.template($('#modal-alert-template').html())(data) })
  return alertModal(data)
}

function showToast(params) {
  var data = _.extend(
    { title: '', titleClasses: '', decor: '', closeButton: true, message: '', autohide: true },
    params
  )
  console.debug('toast', data)
  var toast = $(_.template($('#toast-template').html())(data))
    .appendTo('#toastHolder')
    .toast({ autohide: data.autohide ? true : false })
    .toast('show')
    .on('hidden.bs.toast', function (data) {
      data.currentTarget.remove()
    })
  return toast
}

function showToastError(params) {
  var data = _.extend({ message: '', titleClasses: 'bg-danger text-white', error: '' }, params)
  captureWeb3Error(data.error)
  data.message =
    data.message +
    '<br/>Error code: <samp class="text-break">' +
    data.error.code +
    '</samp><br/>' +
    'Error message: <samp class="text-break">' +
    data.error.message +
    '</samp><br/>'
  return showToast(data)
}

function showToastTransaction(title, tx) {
  console.debug('Got transaction', tx)
  var toast = showToast({
    title: title,
    decor: '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>',
    closeButton: false,
    autohide: false,
    message: 'Transaction hash: <samp class="text-break">' + tx.hash + '</samp>'
  })

  return tx
    .wait()
    .then((receipt) => {
      console.debug(receipt)
      showToast({
        title: title + ' ' + (receipt.status == 1 ? 'succeeded' : 'failed'),
        titleClasses: receipt.status == 1 ? 'bg-success text-white' : 'bg-danger text-white',
        closeButton: receipt.status != 1,
        autohide: receipt.status == 1,
        message: 'Transaction hash: <samp class="text-break">' + receipt.transactionHash + '</samp>'
      })
      return receipt
    })
    .catch((error) => {
      showToastError({
        title: title + ' failed',
        titleClasses: 'bg-danger text-white',
        autohide: false,
        message: 'Transaction hash: <samp class="text-break">' + receipt.transactionHash + '</samp>',
        error: error
      })
    })
    .then(() => toast.toast('hide'))
}

const checkNetwork = async () => {
  if (!isMetaMaskInstalled()) {
    $('#installButton').on('click', onClickInstall).prop('hidden', false)
    return
  }

  const chainId = await ethereum.request({ method: 'eth_chainId' })
  onChainIdChanged(chainId)

  ethereum.on('chainChanged', onChainIdChanged)
}

function checkAccounts() {
  console.debug('checkaccounts')
  $('#connectButton').prop({ hidden: false, disabled: true }).find('.spinner-border').prop('hidden', false)
  $('#accountDetails').prop('hidden', true)
  var dialog = alertModal({
    title: 'Connecting to your wallet',
    closeButton: false,
    message: 'If MetaMask does not prompt, please open it manually to complete connection.'
  })
  ethereum
    .request({ method: 'eth_requestAccounts' })
    .then((result) => {
      console.debug('eth_requestAccounts', result)
      accounts = result

      const isMetaMaskConnected = () => accounts && accounts.length > 0

      if (isMetaMaskConnected()) {
        onAccountsChanged(accounts)
        ethereum.on('accountsChanged', onAccountsChanged)
      } else {
        $('#connectButton').prop('hidden', false).prop('disabled', false)
      }
    })
    .catch((error) => {
      var data = {
        title: 'Connection failed',
        closeButton: false,
        error: error,
        buttons: [{ id: 'retry', classNames: 'btn-primary', text: 'Retry' }]
      }
      if (error.code == -32002)
        _.extend(data, {
          title: 'Can not open metamask',
          message: 'Please open MetaMask manually to make sure no operation is in progress and then click Retry.'
        })
      var errDialog = alertError(data)
      errDialog.find('#retry').on('click', errDialog.modal.bind(errDialog, 'hide')).on('click', onClickConnect)
      $('#connectButton').off('click').on('click', onClickConnect).prop('hidden', false).prop('disabled', false)
    })
    .then(() => dialog.removeClass('fade').on('shown.bs.modal', dialog.modal.bind(dialog, 'hide')).modal('hide'))
}

const onClickInstall = () => {
  $('#installButton').prop('innerText', 'Waiting for installation').prop('disabled', true)
  onboarding.startOnboarding()
}

const onClickConnect = async () => {
  checkAccounts()
}

const onAccountsChanged = async (newAccounts) => {
  accounts = newAccounts

  const isMetaMaskConnected = () => accounts && accounts.length > 0

  if (isMetaMaskConnected()) {
    $('#connectButton').prop('hidden', true)
    $('.toast').remove()
    accountData.address = accounts[0]

    reloadBalance()
    reloadValidators()

    ethereum
      .request({ method: 'eth_getBlockByNumber', params: ['latest', false] })
      .then((result) => {
        console.debug('latest block', result)
        networkData.lastBlock = result
      })
      .catch((error) => {
        console.error('getBlock', error)
      })

    ethereum
      .request({ method: 'eth_subscribe', params: ['newHeads'] })
      .then((result) => {
        console.debug('subscribe', result)
        subscriptions.newBlock = result
        ethereum.on('message', onMessage)
      })
      .catch((error) => {
        console.error('subscribe', error)
      })
  } else {
    $('#connectButton').prop('hidden', false).prop('disabled', false)
  }
}

const onChainIdChanged = async (chainId) => {
  networkData.chainId = chainId
  for (var geneChainId of geneChainIds) {
    if (chainId == geneChainId.id) {
      $('#wrongNetwork').modal('hide')
      if (geneChainId.testnet) {
        $('#network').prop('innerText', ' - ' + geneChainId.name)
        $('title').text(geneChainId.name + ' - GeneChain Staking')
      }
      checkAccounts()
      return
    }
  }
  $('#wrongNetwork').modal().find('#addNetwork').on('click', addNetwork)
}

const onMessage = async (message) => {
  console.debug('message', message)
  if (message.data.subscription == subscriptions.newBlock) networkData.lastBlock = message.data.result
}

function addNetwork() {
  $('#wrongNetwork').modal('hide')
  var dialog = alertModal({
    title: 'Configuring network',
    closeButton: false,
    backdrop: 'static',
    message: 'If MetaMask does not prompt, please open it manually to complete configuration.'
  })
  var chainId = 80
  ethereum
    .request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: '0x' + chainId.toString(16),
          chainName: 'GeneChain',
          nativeCurrency: { name: 'RNA', symbol: 'RNA', decimals: 18 },
          rpcUrls: ['https://rpc.genechain.io'],
          blockExplorerUrls: ['https://scan.genechain.io/']
        }
      ]
    })
    .catch((error) => {
      var data = {
        title: 'Network configuration failed',
        closeButton: false,
        error: error,
        buttons: [{ id: 'retry', classNames: 'btn-primary', text: 'Retry' }]
      }
      if (error.code == -32002)
        _.extend(data, {
          title: 'Can not open metamask',
          message: 'Please open MetaMask manually to make sure no operation is in progress and then click Retry.'
        })
      var errDialog = alertError(data)
      errDialog.find('#retry').on('click', errDialog.modal.bind(errDialog, 'hide')).on('click', addNetwork)
    })
    .then(() => dialog.removeClass('fade').on('shown.bs.modal', dialog.modal.bind(dialog, 'hide')).modal('hide'))
}

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
    this.$el.find('#stake').on('click', this.model, stakeDialog.show)
    this.$el.find('#unstake').on('click', this.model, onUnstakeClicked)
    this.$el.find('#settle').on('click', this.model, settleDialog.show)
    if (!this.model.get('staked')) this.$el.find('#unstake').remove()
    this.$el.find('[data-toggle="popover"]').popover({ trigger: 'focus' })
    this.$el.find('[data-toggle="tooltip"]').tooltip()
    return this
  }
})

let CandidatesView = Backbone.View.extend({
  el: $('#topCandidates').find('table'),
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
  el: $('#stakedCandidates').find('table'),

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
  initialize: function () {
    this.set('accountData', accountData)
  },
  defaults: {
    formatEther: formatEther,
    ready: false,
    validator: '',
    active: false,
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
    return -item.get('stakePower')
  }
})

let StakedCandidate = Candidate.extend({
  defaults: _.extend(_.clone(Candidate.prototype.defaults), {
    staked: true,
    stakedRNA: 0,
    stakedARM: 0,
    stakedPower: 0,
    bookAtValue: 0,
    lockBlock: 0,
    profit: 0
  })
})

let StakedCandidates = Backbone.Collection.extend({
  model: StakedCandidate,
  comparator: function (item) {
    return -item.get('stakePower')
  }
})

let top = new Candidates()
new CandidatesView({ model: top }).render()
let staked = new StakedCandidates()
new StakedCandidatesView({ model: staked }).render()

function reloadBalanceRNA() {
  return ethereum
    .request({ method: 'eth_getBalance', params: [accountData.address, 'latest'] })
    .then((amount) => {
      accountData.balance = amount
      $('#accountDetail').find('#balance').prop('innerText', formatEther(amount))
      return amount
    })
    .catch((error) => alertError({ title: 'Failed to get RNA balance', error: error }))
}

function reloadBalanceARM() {
  var ethersProvider = new Web3Provider(window.ethereum, 'any')
  var armContract = new Contract(armContractAddr, armAbi, ethersProvider)
  return armContract
    .balanceOf(accountData.address)
    .then((amount) => {
      accountData.balanceARM = amount
      $('#accountDetail').find('#balanceARM').prop('innerText', formatEther(amount))
      return amount
    })
    .catch((error) => alertError({ title: 'Failed to get ARM balance', error: error }))
}

const reloadBalance = async () => {
  var account = accountData.address
  var accountDetail = $('#accountDetail')
  accountDetail.prop('hidden', false)
  accountDetail.find('#address').prop('innerText', account)
  accountDetail.find('#exchangeARM').off('click').on('click', onExchangeARMClicked)
  reloadBalanceRNA()
  reloadBalanceARM()

  var ethersProvider = new Web3Provider(window.ethereum, 'any')
  var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider)
  riboseContract
    .getBookedProfit(account)
    .then((profit) => {
      accountData.profit = formatEther(profit)
      accountDetail.find('#profit').prop('innerText', accountData.profit)
      accountDetail.find('#withdrawProfit').off('click').on('click', onWithdrawClicked).prop('hidden', false)
    })
    .catch((error) => {
      console.error('getBookedProfit', error)
      accountDetail.find('#profit').prop('innerText', 0)
      accountDetail.find('#withdrawProfit').prop('hidden', true)
    })
    .then(() => {
      accountDetail.find('#settleAll').off('click').on('click', onSettleAllClicked)
    })
}

const reloadStakedCandidate = async (candidate) => {
  var ethersProvider = new Web3Provider(window.ethereum, 'any')
  var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider)
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
  var info = await riboseContract.getStakingInfo(candidate.get('validator'), accountData.address)
  console.debug('staker info', candidate.get('validator'), accounts[0], info)
  candidate.set({
    stakedRNA: formatEther(info[0]),
    stakedARM: formatEther(info[1]),
    stakedPower: info[2],
    bookAtValue: info[3],
    lockBlock: parseInt(info[4])
  })
  var profit = await riboseContract.getStakerUnsettledProfit(candidate.get('validator'), accountData.address)
  candidate.set({ profit: formatEther(profit), ready: true })
}

const reloadTopCandidate = async (candidate) => {
  var ethersProvider = new Web3Provider(window.ethereum, 'any')
  var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider)
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
    return
  }
  var info = await riboseContract.getCandidateStakeInfo(candidate.get('validator'))
  console.debug('candidate info', candidate.get('validator'), info)
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

const reloadCandidate = async (address) => {
  var s = staked.findWhere({ validator: address })
  var t = top.findWhere({ validator: address })
  if (t) t.set({ ready: false })
  if (s) {
    s.set({ ready: false })
  } else {
    var ethersProvider = new Web3Provider(window.ethereum, 'any')
    var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider)
    var stakedCandidates = await riboseContract.getStakedCandidates(accounts[0])
    console.debug('staked candidates', stakedCandidates)
    if (stakedCandidates.length > 0 && stakedCandidates.indexOf(address) >= 0) {
      s = staked.add(new StakedCandidate({ validator: address }))
      if (t) {
        t.set({ staked: true })
        s.set({ stakePower: t.get('stakePower') })
      }
    }
  }
  if (s) await reloadStakedCandidate(s)
  if (t) reloadTopCandidate(t)
}

const reloadValidators = async () => {
  top.reset()
  staked.reset()
  $('#topCandidates').find('.spinner-border').prop('hidden', false)
  $('#stakedCandidates').find('.spinner-border').prop('hidden', false)

  var ethersProvider = new Web3Provider(window.ethereum, 'any')
  var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider)

  // load staked candidates
  var stakedCandidates = await riboseContract.getStakedCandidates(accounts[0])
  console.debug('staked candidates', stakedCandidates)
  if (stakedCandidates.length > 0) {
    stakedCandidates.forEach(function (addr, index) {
      staked.add(new StakedCandidate({ validator: addr }))
    })
    $('#stakedCandidates').find('.spinner-border').prop('hidden', true)
  }
  $('#stakedCandidates').prop('hidden', stakedCandidates.length == 0)

  // load top candidates
  var topCandidates = await riboseContract.getTopCandidates()
  console.debug('top candidates', topCandidates)
  topCandidates[0].forEach(function (addr, index) {
    var t = top.add(new Candidate({ validator: addr, stakePower: topCandidates[1][index] }))
    if (stakedCandidates.indexOf(addr) >= 0) {
      t.set({ staked: true })
      var s = staked.findWhere({ validator: addr })
      if (s) s.set({ stakePower: topCandidates[1][index] })
    }
  })
  $('#topCandidates').find('.spinner-border').prop('hidden', true)

  validators = await riboseContract.getValidators()
  console.debug('validators', validators)
  validators.forEach((addr, index) => {
    var t = top.findWhere({ validator: addr })
    if (t) t.set({ active: true })
    var s = staked.findWhere({ validator: addr })
    if (s) s.set({ active: true })
  })

  await Promise.all(staked.map(reloadStakedCandidate))
  await Promise.all(top.map(reloadTopCandidate))
}

// Stake dialog
var stakeDialog = {
  view: Backbone.View.extend({
    tagName: 'div',
    className: 'modal fade',
    attributes: { tabindex: -1 },
    template: _.template($('#stake-template').html()),
    allowedARM: Zero,

    show: function () {
      this.$el.modal()
      this.loadAllowrance()
      return this
    },
    close: function () {
      this.$el.modal('hide')
      return this
    },
    loadAllowrance: function () {
      var ethersProvider = new Web3Provider(window.ethereum, 'any')
      var armContract = new Contract(armContractAddr, armAbi, ethersProvider.getSigner())
      return armContract
        .allowance(accountData.address, riboseContractAddr)
        .then((result) => {
          this.allowedARM = result
          this.$el.find('#allowedARM').prop('innerText', formatEther(result))
          this.$el.find('#approveDiv').prop('hidden', !result.lt(parseEther('3')))
          this.$el.find('#arm').prop('disabled', result.lt(parseEther('3')))
          this.$el.find('#approve').off('click').on('click', this.approve.bind(this))
          return result
        })
        .catch((error) => alertError({ title: 'Failed to get ARM allowance', error: error }))
    },
    approve: function () {
      var val = 0
      try {
        if (this.$el.find('#approveARM').val().length > 0) val = parseEther(this.$el.find('#approveARM').val())
      } catch (error) {
        alertError({ title: 'Unexpect Error', error: error })
        return
      }
      if (val == 0 || val.isZero()) {
        alertError('ARM should be greater than 0')
        return
      }

      this.$el.find('#approve').prop('disabled', true).find('.spinner-border').prop('hidden', false)

      var ethersProvider = new Web3Provider(window.ethereum, 'any')
      var armContract = new Contract(armContractAddr, armAbi, ethersProvider.getSigner())
      armContract.estimateGas
        .approve(riboseContractAddr, val)
        .then((gasEstimate) => {
          armContract
            .approve(riboseContractAddr, val, {
              gasLimit: gasEstimate.mul(BigNumber.from(11000)).div(BigNumber.from(10000))
            })
            .then((result) =>
              showToastTransaction('Approve ARM', result).then((receipt) => {
                if (receipt.status == 1) {
                  this.$el.find('#approve').prop('disabled', false).find('.spinner-border').prop('hidden', true)
                  this.$el.find('#approveDiv').prop('hidden', true)
                  this.loadAllowrance()
                }
              })
            )
            .catch((error) => {
              alertError({ title: 'Failed to set ARM allowance', error: error })
              this.$el.find('#approve').prop('disabled', false).find('.spinner-border').prop('hidden', true)
            })
        })
        .catch((error) => {
          alertError({ title: 'Failed to estimate gas', error: error })
          this.$el.find('#approve').prop('disabled', false).find('.spinner-border').prop('hidden', true)
        })
    },

    submit: async function (event) {
      this.model.set('accountData', accountData)
      var form = this.$('form')
      var rna = 0,
        arm = 0
      try {
        if (form.find('#rna').val().length > 0) rna = parseEther(form.find('#rna').val())
        if (form.find('#arm').val().length > 0) arm = parseEther(form.find('#arm').val())
      } catch (error) {
        alertError({ title: 'Unexpect Error', error: error })
        return
      }
      if (arm == 0) {
        if (rna == 0) {
          alertError('You should stake at least 1 RNA or 3 ARMs')
          return
        }
      } else if (arm.lt(parseEther('3'))) {
        alertError('ARM should be at least 3')
        return
      }
      this.$('#confirm').prop('disabled', true).find('.spinner-border').prop('hidden', false)
      var ethersProvider = new Web3Provider(window.ethereum, 'any')
      var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider.getSigner())
      riboseContract.estimateGas
        .stake(this.model.get('validator'), arm, { value: rna })
        .then((gasEstimate) => {
          riboseContract
            .stake(this.model.get('validator'), arm, {
              value: rna,
              gasLimit: gasEstimate.mul(BigNumber.from(11000)).div(BigNumber.from(10000))
            })
            .then((result) => {
              this.close()
              showToastTransaction('Stake', result).then((receipt) => {
                if (receipt.status == 1) {
                  reloadBalance()
                  reloadCandidate(this.model.get('validator'))
                }
              })
            })
            .catch((error) => alertError({ title: 'Stake failed', error: error }))
            .then(
              function () {
                this.$('#confirm').prop('disabled', false).find('.spinner-border').prop('hidden', true)
              }.bind(this)
            )
        })
        .catch((error) => {
          alertError({ title: 'Failed to estimate gas', error: error })
          this.$('#confirm').prop('disabled', false).find('.spinner-border').prop('hidden', true)
        })
    },

    render: function () {
      this.$el.html(this.template(this.model.toJSON()))
      this.$el.on('hidden.bs.modal', function (event) {
        event.currentTarget.remove()
      })
      this.$('#confirm').on('click', this.submit.bind(this))
      this.$el.appendTo('body')
      return this
    }
  }),

  show: function (event) {
    var candidate = event.data
    new stakeDialog.view({ model: candidate }).render().show()
  }
}

function onUnstakeClicked(event) {
  var model = event.data
  model.set('lastBlock', networkData.lastBlock)
  var data = {
    title: 'Unstake from candidate',
    buttons: [
      {
        id: 'confirm',
        text: '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" hidden></span>Unstake',
        classNames: 'btn-primary'
      }
    ],
    message: _.template($('#unstake-template').html())(model.toJSON())
  }
  var modal = alertModal(data)
  modal.find('#confirm').on('click', function () {
    var form = modal.find('form')
    var rna = 0,
      arm = 0
    try {
      if (form.find('#rna').val().length > 0) rna = parseEther(form.find('#rna').val())
      if (form.find('#arm').val().length > 0) arm = parseEther(form.find('#arm').val())
    } catch (error) {
      alertError({ title: 'Unexpect Error', error: error })
      return
    }
    if (arm == 0 && rna == 0) {
      alertError('RNA and ARM can not be both 0')
      return
    }

    modal.find('#confirm').prop('disabled', true).find('.spinner-border').prop('hidden', false)
    var ethersProvider = new Web3Provider(window.ethereum, 'any')
    var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider.getSigner())
    riboseContract.estimateGas
      .unstake(model.get('validator'), rna, arm)
      .then((gasEstimate) => {
        riboseContract
          .unstake(model.get('validator'), rna, arm, {
            gasLimit: gasEstimate.mul(BigNumber.from(11000)).div(BigNumber.from(10000))
          })
          .then((result) => {
            modal.modal('hide')
            showToastTransaction('Unstake', result).then((receipt) => {
              if (receipt.status == 1) {
                reloadBalance()
                reloadCandidate(model.get('validator'))
              }
            })
          })
          .catch((error) => alertError({ title: 'Unstake failed', error: error }))
          .then(() => modal.find('#confirm').prop('disabled', false).find('.spinner-border').prop('hidden', true))
      })
      .catch((error) => {
        alertError({ title: 'Failed to estimate gas', error: error })
        modal.find('#confirm').prop('disabled', false).find('.spinner-border').prop('hidden', true)
      })
  })
}

// Settle dialog
var settleDialog = {
  view: Backbone.View.extend({
    tagName: 'div',
    className: 'modal fade',
    attributes: { tabindex: -1 },
    template: _.template($('#settle-template').html()),

    show: function () {
      this.$el.modal()
      return this
    },
    close: function () {
      this.$el.modal('hide')
      return this
    },

    submit: async function (event) {
      this.$('#confirm').prop('disabled', true).find('.spinner-border').prop('hidden', false)
      var ethersProvider = new Web3Provider(window.ethereum, 'any')
      var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider.getSigner())
      riboseContract.estimateGas
        .settleStakerProfit(this.model.get('validator'))
        .then((gasEstimate) => {
          riboseContract
            .settleStakerProfit(this.model.get('validator'), {
              gasLimit: gasEstimate.mul(BigNumber.from(11000)).div(BigNumber.from(10000))
            })
            .then((result) => {
              this.close()
              showToastTransaction('Settle reward', result).then((receipt) => {
                if (receipt.status == 1) {
                  reloadBalance()
                  this.model.set({ ready: false })
                  reloadStakedCandidate(this.model)
                }
              })
            })
            .catch((error) => alertError({ title: 'Settle failed', error: error }))
            .then(
              function () {
                this.$('#confirm').prop('disabled', false).find('.spinner-border').prop('hidden', true)
              }.bind(this)
            )
        })
        .catch((error) => {
          alertError({ title: 'Failed to estimate gas', error: error })
          this.$('#confirm').prop('disabled', false).find('.spinner-border').prop('hidden', true)
        })
    },

    render: function () {
      this.$el.html(this.template(this.model.toJSON()))
      this.$el.on('hidden.bs.modal', function (event) {
        event.currentTarget.remove()
      })
      this.$('#confirm').on('click', this.submit.bind(this))
      this.$el.appendTo('body')
      return this
    }
  }),

  show: function (event) {
    var candidate = event.data
    new settleDialog.view({ model: candidate }).render().show()
  }
}

function onWithdrawClicked(event) {
  var data = {
    title: 'Withdraw Profit',
    buttons: [
      {
        id: 'withdraw',
        text: '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" hidden></span>Withdraw',
        classNames: 'btn-primary'
      }
    ],
    message:
      '<p>Estimate profit to withdraw:<br/><samp>' +
      accountData.profit +
      '</samp><small class="text-muted">RNA</small></p><small class="text-muted">' +
      'Please note: All settled reward will be withdrawed.' +
      '</small>'
  }

  var modal = alertModal(data)
  modal.find('#withdraw').on('click', function () {
    modal.find('#withdraw').prop('disabled', true).find('.spinner-border').prop('hidden', false)
    var ethersProvider = new Web3Provider(window.ethereum, 'any')
    var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider.getSigner())
    riboseContract.estimateGas
      .withdrawStakerProfits(accountData.address)
      .then((gasEstimate) => {
        riboseContract
          .withdrawStakerProfits(accountData.address, {
            gasLimit: gasEstimate.mul(BigNumber.from(11000)).div(BigNumber.from(10000))
          })
          .then((result) => {
            modal.modal('hide')
            showToastTransaction('Withdraw profit', result).then((receipt) => {
              if (receipt.status == 1) {
                reloadBalance()
              }
            })
          })
          .catch((error) => alertError({ title: 'Withdraw failed', error: error }))
          .then(() => modal.find('#withdraw').prop('disabled', false).find('.spinner-border').prop('hidden', true))
      })
      .catch((error) => {
        alertError({ title: 'Failed to estimate gas', error: error })
        modal.find('#withdraw').prop('disabled', false).find('.spinner-border').prop('hidden', true)
      })
  })
  modal.find('#settleAll').on('click', function () {
    modal.find('#settleAll').prop('disabled', true).find('.spinner-border').prop('hidden', false)
    var ethersProvider = new Web3Provider(window.ethereum, 'any')
    var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider.getSigner())
    riboseContract.estimateGas
      .settleAllStakerProfit()
      .then((gasEstimate) => {
        riboseContract
          .settleAllStakerProfit({
            gasLimit: gasEstimate.mul(BigNumber.from(11000)).div(BigNumber.from(10000))
          })
          .then((result) => {
            modal.modal('hide')
            showToastTransaction('Withdraw profit', result).then((receipt) => {
              if (receipt.status == 1) {
                reloadBalance()
              }
            })
          })
          .catch((error) => alertError({ title: 'Withdraw failed', error: error }))
          .then(() => modal.find('#withdraw').prop('disabled', false).find('.spinner-border').prop('hidden', true))
      })
      .catch((error) => {
        alertError({ title: 'Failed to estimate gas', error: error })
        modal.find('#withdraw').prop('disabled', false).find('.spinner-border').prop('hidden', true)
      })
  })
}

function onSettleAllClicked(event) {
  var data = {
    title: 'Settle All Unsettled Rewards',
    buttons: [
      {
        id: 'confirm',
        text: '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" hidden></span>Confirm',
        classNames: 'btn-primary'
      }
    ],
    message: '<p>This will settle all your unsettled rewards from all candidates that you staked.</p>'
  }

  var modal = alertModal(data)
  modal.find('#confirm').on('click', function () {
    modal.find('#confirm').prop('disabled', true).find('.spinner-border').prop('hidden', false)
    var ethersProvider = new Web3Provider(window.ethereum, 'any')
    var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider.getSigner())
    riboseContract.estimateGas
      .settleAllStakerProfit()
      .then((gasEstimate) => {
        riboseContract
          .settleAllStakerProfit({ gasLimit: gasEstimate.mul(BigNumber.from(11000)).div(BigNumber.from(10000)) })
          .then((result) => {
            modal.modal('hide')
            showToastTransaction('Settle all', result).then((receipt) => {
              if (receipt.status == 1) {
                reloadBalance()
                staked.map((s) => {
                  s.set({ ready: false })
                  reloadStakedCandidate(s)
                })
              }
            })
          })
          .catch((error) => alertError({ title: 'Settle all failed', error: error }))
          .then(() => modal.find('#confirm').prop('disabled', false).find('.spinner-border').prop('hidden', true))
      })
      .catch((error) => {
        alertError({ title: 'Failed to estimate gas', error: error })
        modal.find('#confirm').prop('disabled', false).find('.spinner-border').prop('hidden', true)
      })
  })
}

function onExchangeARMClicked(event) {
  var vbcContract, allowedVBC, stakedVBC
  var data = {
    title: 'Mint ARM',
    message: _.template($('#exchange-arm-template').html())(accountData)
  }
  var modal = alertModal(data)

  function reloadBalanceVBC() {
    return vbcContract
      .balanceOf(accountData.address)
      .then((bal) => {
        accountData.balanceVBC = bal
        modal.find('#balanceVBC').prop('innerText', formatEther(bal))
        return bal
      })
      .catch((error) => alertError({ title: 'Failed to get VBC balance', error: error }))
  }

  function reloadAllowanceVBC() {
    return vbcContract
      .allowance(accountData.address, armContractAddr)
      .then((result) => {
        allowedVBC = result
        modal.find('#allowedVBC').prop('innerText', formatEther(result))
        modal.find('#approveSpinner').prop('hidden', true)
        modal.find('#approveDiv').prop('hidden', !result.lt(WeiPerEther))
        modal.find('#stakeDiv').prop('hidden', result.lt(WeiPerEther))
        return result
      })
      .catch((error) => alertError({ title: 'Failed to get VBC allowance', error: error }))
  }
  function reloadStakedVBC() {
    return armContract
      .getExchangeInfo(accountData.address)
      .then((result) => {
        stakedVBC = result[1]
        modal.find('#memo').val(result[0])
        modal.find('#stakedVBC').prop('innerText', formatEther(result[1]))
        return result
      })
      .catch((error) => alertError({ title: 'Failed to get staked VBC', error: error }))
  }

  var ethersProvider = new Web3Provider(window.ethereum, 'any')
  var armContract = new Contract(armContractAddr, armAbi, ethersProvider.getSigner())
  //Get vbc contract address
  armContract
    .SrcTokenAddr()
    .then((addr) => {
      if (!addr || addr == 0) {
        alertError('VBC contract address unavailable')
        return
      }
      vbcContract = new Contract(addr, vbcAbi, ethersProvider.getSigner())
      reloadBalanceVBC()
      reloadAllowanceVBC()
    })
    .catch((error) => alertError({ title: 'Failed to get VBC contract address', error: error }))

  reloadStakedVBC()

  modal.find('#approve').on('click', function () {
    var val = 0
    try {
      if (modal.find('#approveVBC').val().length > 0) val = parseEther(modal.find('#approveVBC').val())
    } catch (error) {
      alertError({ title: 'Unexpect Error', error: error })
      return
    }
    if (val == 0 || val.isZero()) {
      alertError('VBC should be greater than 0')
      return
    }

    modal.find('#approve').prop('disabled', true).find('.spinner-border').prop('hidden', false)

    vbcContract.estimateGas
      .approve(armContractAddr, val)
      .then((gasEstimate) => {
        vbcContract
          .approve(armContractAddr, val, {
            gasLimit: gasEstimate.mul(BigNumber.from(11000)).div(BigNumber.from(10000))
          })
          .then((result) =>
            showToastTransaction('Approve VBC', result).then((receipt) => {
              if (receipt.status == 1) {
                modal.find('#approve').prop('disabled', false).find('.spinner-border').prop('hidden', true)
                modal.find('#approveSpinner').prop('hidden', false)
                modal.find('#approveDiv').prop('hidden', true)
                reloadAllowanceVBC()
              }
            })
          )
          .catch((error) => {
            alertError({ title: 'Failed to set VBC allowance', error: error })
            modal.find('#approve').prop('disabled', false).find('.spinner-border').prop('hidden', true)
          })
      })
      .catch((error) => {
        alertError({ title: 'Failed to estimate gas', error: error })
        modal.find('#approve').prop('disabled', false).find('.spinner-border').prop('hidden', true)
      })
  })

  modal.find('#stake').on('click', function () {
    var val = 0
    try {
      if (modal.find('#stakeVBC').val().length > 0) val = parseEther(modal.find('#stakeVBC').val())
    } catch (error) {
      alertError({ title: 'Unexpect Error', error: error })
      return
    }
    if (val == 0 || val.isZero()) {
      alertError('VBC should be greater than 0')
      return
    } else if (val.gt(accountData.balanceVBC)) {
      alertError('Not efficient VBC')
      return
    } else if (val.gt(allowedVBC)) {
      alertError('Can not stake more than allowance')
      return
    }

    modal.find('#stake').prop('disabled', true).find('.spinner-border').prop('hidden', false)
    var ethersProvider = new Web3Provider(window.ethereum, 'any')
    var armContract = new Contract(armContractAddr, armAbi, ethersProvider.getSigner())
    armContract.estimateGas
      .exchange(val)
      .then((gasEstimate) => {
        armContract
          .exchange(val, {
            gasLimit: gasEstimate.mul(BigNumber.from(11000)).div(BigNumber.from(10000))
          })
          .then((result) =>
            showToastTransaction('Stake VBC', result).then((receipt) => {
              if (receipt.status == 1) {
                reloadBalanceARM().then((bal) => modal.find('#balanceARM').prop('innerText', formatEther(bal)))
                reloadBalanceVBC()
                reloadStakedVBC()
                reloadAllowanceVBC()
                modal.find('#stake').prop('disabled', false).find('.spinner-border').prop('hidden', true)
              }
            })
          )
          .catch((error) => {
            alertError({ title: 'Stake VBC failed', error: error })
            modal.find('#stake').prop('disabled', false).find('.spinner-border').prop('hidden', true)
          })
      })
      .catch((error) => {
        alertError({ title: 'Failed to estimate gas', error: error })
        modal.find('#stake').prop('disabled', false).find('.spinner-border').prop('hidden', true)
      })
  })

  modal.find('#unstake').on('click', function () {
    var val = 0
    try {
      if (modal.find('#stakeVBC').val().length > 0) val = parseEther(modal.find('#stakeVBC').val())
    } catch (error) {
      alertError({ title: 'Unexpect Error', error: error })
      return
    }
    if (val == 0 || val.isZero()) {
      alertError('VBC should be greater than 0')
      return
    } else if (val.gt(accountData.balanceARM)) {
      alertError('Not efficient ARM')
      return
    } else if (val.gt(stakedVBC)) {
      alertError('Can not burn more than staked VBC')
      return
    }
    modal.find('#unstake').prop('disabled', true).find('.spinner-border').prop('hidden', false)
    var ethersProvider = new Web3Provider(window.ethereum, 'any')
    var armContract = new Contract(armContractAddr, armAbi, ethersProvider.getSigner())
    armContract.estimateGas
      .burn(val)
      .then((gasEstimate) => {
        armContract
          .burn(val, {
            gasLimit: gasEstimate.mul(BigNumber.from(11000)).div(BigNumber.from(10000))
          })
          .then((result) =>
            showToastTransaction('Unstake VBC', result).then((receipt) => {
              if (receipt.status == 1) {
                reloadBalanceARM().then((bal) => modal.find('#balanceARM').prop('innerText', formatEther(bal)))
                reloadBalanceVBC()
                reloadStakedVBC()
                modal.find('#unstake').prop('disabled', false).find('.spinner-border').prop('hidden', true)
              }
            })
          )
          .catch((error) => {
            alertError({ title: 'Unstake VBC failed', error: error })
            modal.find('#unstake').prop('disabled', false).find('.spinner-border').prop('hidden', true)
          })
      })
      .catch((error) => {
        alertError({ title: 'Failed to estimate gas', error: error })
        modal.find('#unstake').prop('disabled', false).find('.spinner-border').prop('hidden', true)
      })
  })

  modal.find('#setMemo').on('click', function () {
    var val = modal.find('#memo').val()
    if (val.length != 0 && (val.length != 34 || val[0] != 'r')) {
      alertError('Not a valid radar address')
      return
    }
    modal.find('#setMemo').prop('disabled', true).find('.spinner-border').prop('hidden', false)
    var ethersProvider = new Web3Provider(window.ethereum, 'any')
    var armContract = new Contract(armContractAddr, armAbi, ethersProvider.getSigner())
    armContract.estimateGas
      .setMemo(val)
      .then((gasEstimate) => {
        armContract
          .setMemo(val, {
            gasLimit: gasEstimate.mul(BigNumber.from(11000)).div(BigNumber.from(10000))
          })
          .then((result) =>
            showToastTransaction('Set ARM staking memo', result).then((receipt) => {
              if (receipt.status == 1) {
                reloadStakedVBC().then(() =>
                  modal.find('#setMemo').prop('disabled', false).find('.spinner-border').prop('hidden', true)
                )
              }
            })
          )
          .catch((error) => {
            alertError({ title: 'Set memo failed', error: error })
            modal.find('#setMemo').prop('disabled', false).find('.spinner-border').prop('hidden', true)
          })
      })
      .catch((error) => {
        alertError({ title: 'Failed to estimate gas', error: error })
        modal.find('#setMemo').prop('disabled', false).find('.spinner-border').prop('hidden', true)
      })
  })
}
