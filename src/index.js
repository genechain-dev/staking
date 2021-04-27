import 'bootstrap/js/dist/modal'
import 'bootstrap/js/dist/popover'
import 'bootstrap/js/dist/toast'
import 'backbone'
import _ from 'underscore'
import MetaMaskOnboarding from '@metamask/onboarding'
import { armContractAddr, riboseContractAddr, riboseAbi } from './constants.json'
import { Web3Provider } from '@ethersproject/providers'
import { Contract } from '@ethersproject/contracts'
import { formatEther, parseEther } from '@ethersproject/units'
import { WeiPerEther } from '@ethersproject/constants'

const geneChainId = 8080
const rewardPerBlock = 2
const rewardShare = 0.8
const rewardPerDay = rewardPerBlock * rewardShare * 28800
const rewardPerYear = rewardPerDay * 365

const currentUrl = new URL(window.location.href)
const forwarderOrigin = currentUrl.hostname === 'localhost' ? 'http://localhost:9010' : undefined

const { isMetaMaskInstalled } = MetaMaskOnboarding

let onboarding
let accounts
let accountData = { address: '', balance: 0, balanceARM: 0, profit: 0 }
let networkData = { chainId: 0, lastBlock: 0 }
let subscriptions = { newBlock: 0 }

const initialize = () => {
  try {
    onboarding = new MetaMaskOnboarding({ forwarderOrigin })
  } catch (error) {
    console.error(error)
  }
  checkNetwork()
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
  return $(_.template($('#modal-template').html())(data))
    .appendTo('body')
    .modal(data)
    .modal('show')
    .on('hidden.bs.modal', function (data) {
      data.currentTarget.remove()
    })
}

function alertError(params) {
  var data = _.extend(
    { message: '', error: '' },
    typeof params === 'string' || params instanceof String ? { title: 'Error', message: params } : params
  )
  if (data.error && data.error.data)
    data.error.details = JSON.stringify(data.error.data, Object.getOwnPropertyNames(data.error.data))
  _.extend(data, { message: _.template($('#modal-alert-template').html())(data) })
  return alertModal(data)
}

function showToast(params) {
  var data = _.extend(
    { title: '', titleClasses: '', decor: '', closeButton: true, message: '', autohide: true },
    params
  )
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
  console.warn('checkaccounts')
  $('#connectButton').prop({ hidden: false, disabled: true }).find('.spinner-border').prop('hidden', false)
  $('#accountDetails').prop('hidden', true)
  var dialog = alertModal({
    title: 'Connecting to your wallet',
    closeButton: false,
    backdrop: 'static',
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
    .finally(function () {
      dialog.removeClass('fade').on('shown.bs.modal', dialog.modal.bind(dialog, 'hide')).modal('hide')
    })
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
  if (chainId != geneChainId) {
    $('#wrongNetwork').modal().find('#addNetwork').on('click', addNetwork)
    return
  }
  $('#wrongNetwork').modal('hide')

  checkAccounts()
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
  ethereum
    .request({
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
    .finally(() => {
      dialog.removeClass('fade').on('shown.bs.modal', dialog.modal.bind(dialog, 'hide')).modal('hide')
    })
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
    return -item.get('power')
  }
})

let top = new Candidates()
new CandidatesView({ model: top }).render()
let staked = new StakedCandidates()
new StakedCandidatesView({ model: staked }).render()

const reloadBalance = async () => {
  var account = accountData.address
  var accountDetail = $('#accountDetail')
  accountDetail.prop('hidden', false)
  accountDetail.find('#address').prop('innerText', account)
  ethereum
    .request({
      method: 'eth_getBalance',
      params: [account]
    })
    .then((bal) => {
      accountData.balance = formatEther(bal)
      accountDetail.find('#balance').prop('innerText', accountData.balance)
    })
  ethereum
    .request({
      method: 'eth_call',
      params: [
        {
          to: armContractAddr,
          data: '0x70a08231000000000000000000000000' + account.replace(/^0x/, '')
        },
        'latest'
      ]
    })
    .then((balARM) => {
      accountData.balanceARM = formatEther(balARM)
      accountDetail.find('#balanceARM').prop('innerText', accountData.balanceARM)
    })
    .catch((error) => {
      console.error('get arm balance', error)
    })

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
      accountDetail.find('#profit').prop('innerText', 0)
      accountDetail.find('#withdrawProfit').prop('hidden', true)
      console.error('getBookedProfit', error)
    })
}

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
      staked.add(new StakedCandidate({ validator: addr }))
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
      lockBlock: parseInt(info[4])
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
}

// Stake dialog
var stakeDialog = {
  view: Backbone.View.extend({
    tagName: 'div',
    className: 'modal fade',
    attributes: { tabindex: -1 },
    template: _.template($('#stake-template').html()),

    show: function () {
      this.$el.modal()
    },
    close: function () {
      this.$el.modal('hide')
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
        console.error(error)
        alertError({ title: 'Unexpect Error', error: error })
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
        .then(
          function (result) {
            console.debug(result)
            this.close()
            var toast = showToast({
              title: 'Stake',
              decor: '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>',
              closeButton: false,
              autohide: false,
              message: 'Transaction hash: <samp class="text-break">' + result.hash + '</samp>'
            })
            result
              .wait()
              .then((receipt) => {
                console.debug(receipt)
                showToast({
                  title: receipt.status == 1 ? 'Stake succeeded' : 'Stake failed',
                  titleClasses: receipt.status == 1 ? 'bg-success text-white' : 'bg-danger text-white',
                  closeButton: receipt.status != 1,
                  autohide: receipt.status == 1,
                  message: 'Transaction hash: <samp class="text-break">' + receipt.transactionHash + '</samp>'
                })
                if (receipt.status == 1) {
                  reloadBalance()
                  reloadValidators()
                }
              })
              .catch((error) => {
                console.error(error)
                showToastError({
                  title: 'Stake failed',
                  titleClasses: 'bg-danger text-white',
                  autohide: false,
                  message: 'Transaction hash: <samp class="text-break">' + result.hash + '</samp>',
                  error: error
                })
              })
              .finally(function () {
                toast.toast('hide')
              })
          }.bind(this)
        )
        .catch((error) => {
          console.error(error)
          alertError({
            title: 'Stake failed',
            error: error
          })
        })
        .finally(
          function () {
            this.$('#confirm').prop('disabled', false).find('.spinner-border').prop('hidden', true)
          }.bind(this)
        )
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
      console.error(error)
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
    riboseContract
      .unstake(model.get('validator'), rna, arm)
      .then(
        function (result) {
          modal.modal('hide')
          var toast = showToast({
            title: 'Unstake',
            decor: '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>',
            closeButton: false,
            autohide: false,
            message: 'Transaction hash: <samp class="text-break">' + result.hash + '</samp>'
          })
          result
            .wait()
            .then((receipt) => {
              console.debug(receipt)
              showToast({
                title: 'Unstake ' + (receipt.status == 1 ? 'succeeded' : 'failed'),
                titleClasses: receipt.status == 1 ? 'bg-success text-white' : 'bg-danger text-white',
                closeButton: receipt.status != 1,
                autohide: receipt.status == 1,
                message: 'Transaction hash: <samp class="text-break">' + receipt.transactionHash + '</samp>'
              })
              if (receipt.status == 1) {
                reloadBalance()
                reloadValidators()
              }
            })
            .catch((error) => {
              console.error(error)
              showToastError({
                title: 'Unstake failed',
                titleClasses: 'bg-danger text-white',
                autohide: false,
                message: 'Transaction hash: <samp class="text-break">' + result.hash + '</samp>',
                error: error
              })
            })
            .finally(function () {
              toast.toast('hide')
            })
        }.bind(this)
      )
      .catch((error) => {
        console.error(error)
        alertError({
          title: 'Unstake failed',
          error: error
        })
      })
      .finally(function () {
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
    },
    close: function () {
      this.$el.modal('hide')
    },

    submit: async function (event) {
      this.$('#confirm').prop('disabled', true).find('.spinner-border').prop('hidden', false)
      var ethersProvider = new Web3Provider(window.ethereum, 'any')
      var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider.getSigner())
      riboseContract
        .settleStakerProfit(this.model.get('validator'))
        .then((result) => {
          console.debug(result)
          var toast = showToast({
            title: 'Settle reward',
            decor: '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>',
            closeButton: false,
            autohide: false,
            message: 'Transaction hash: <samp class="text-break">' + result.hash + '</samp>'
          })
          this.close()

          result
            .wait()
            .then((receipt) => {
              console.debug(receipt)
              showToast({
                title: 'Settle reward ' + (receipt.status == 1 ? 'succeeded' : 'failed'),
                titleClasses: receipt.status == 1 ? 'bg-success text-white' : 'bg-danger text-white',
                closeButton: receipt.status != 1,
                autohide: receipt.status == 1,
                message: 'Transaction hash: <samp class="text-break">' + receipt.transactionHash + '</samp>',
                autohide: true
              })
              if (receipt.status == 1) {
                reloadBalance()
                reloadValidators()
              }
            })
            .catch((error) => {
              console.error(error)
              showToastError({
                title: 'Settle reward failed',
                titleClasses: 'bg-danger text-white',
                autohide: false,
                message: 'Transaction hash: <samp class="text-break">' + receipt.transactionHash + '</samp>',
                error: error
              })
            })
            .finally(function () {
              toast.toast('hide')
            })
        })
        .catch((error) => {
          console.error(error)
          alertError({
            title: 'Settle failed',
            error: error
          })
        })
        .finally(
          function () {
            this.$('#confirm').prop('disabled', false).find('.spinner-border').prop('hidden', true)
          }.bind(this)
        )
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
    titleClasses: '',
    closeButton: true,
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
      '</small>',
    bodyClasses: ''
  }

  var modal = $(_.template($('#modal-template').html())(data))
    .appendTo('body')
    .modal(data)
    .modal('show')
    .on('hidden.bs.modal', function (data) {
      data.currentTarget.remove()
    })
  modal.find('#withdraw').on('click', function () {
    modal.find('#withdraw').prop('disabled', true).find('.spinner-border').prop('hidden', false)
    var ethersProvider = new Web3Provider(window.ethereum, 'any')
    var riboseContract = new Contract(riboseContractAddr, riboseAbi, ethersProvider.getSigner())
    riboseContract
      .withdrawStakerProfits(accountData.address)
      .then((result) => {
        console.debug(result)
        var toast = showToast({
          title: 'Withdraw profit',
          decor: '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>',
          closeButton: false,
          autohide: false,
          message: 'Transaction hash: <samp class="text-break">' + result.hash + '</samp>'
        })
        modal.modal('hide')

        result
          .wait()
          .then((receipt) => {
            console.debug(receipt)
            showToast({
              title: 'Withdraw profit ' + (receipt.status == 1 ? 'succeeded' : 'failed'),
              titleClasses: receipt.status == 1 ? 'bg-success text-white' : 'bg-danger text-white',
              closeButton: receipt.status != 1,
              autohide: receipt.status == 1,
              message: 'Transaction hash: <samp class="text-break">' + receipt.transactionHash + '</samp>',
              autohide: true
            })
            if (receipt.status == 1) {
              reloadBalance()
              reloadValidators()
            }
          })
          .catch((error) => {
            console.error(error)
            showToastError({
              title: 'Withdraw reward failed',
              titleClasses: 'bg-danger text-white',
              autohide: false,
              message: 'Transaction hash: <samp class="text-break">' + receipt.transactionHash + '</samp>',
              error: error
            })
          })
          .finally(function () {
            toast.toast('hide')
          })
      })
      .catch((error) => {
        console.error(error)
        alertError({
          title: 'Withdraw failed',
          error: error
        })
      })
      .finally(function () {
        modal.find('#withdraw').prop('disabled', false).find('.spinner-border').prop('hidden', true)
      })
  })
}
