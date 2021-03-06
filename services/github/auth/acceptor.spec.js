'use strict'

const { expect } = require('chai')
const Camp = require('camp')
const got = require('got')
const queryString = require('query-string')
const nock = require('nock')
const config = require('../../../lib/test-config')
const serverSecrets = require('../../../lib/server-secrets')
const acceptor = require('./acceptor')

const baseUri = `http://127.0.0.1:${config.port}`
const fakeClientId = 'githubdabomb'

describe('Github token acceptor', function() {
  // Frustratingly, potentially undefined properties can't reliably be stubbed
  // with Sinon.
  // https://github.com/sinonjs/sinon/pull/1557
  before(function() {
    serverSecrets.gh_client_id = fakeClientId
    serverSecrets.shieldsIps = []
  })
  after(function() {
    delete serverSecrets.gh_client_id
    delete serverSecrets.shieldsIps
  })

  let camp
  beforeEach(function(done) {
    camp = Camp.start({ port: config.port, hostname: '::' })
    camp.on('listening', () => done())
  })
  afterEach(function(done) {
    if (camp) {
      camp.close(() => done())
      camp = null
    }
  })

  beforeEach(function() {
    acceptor.setRoutes(camp)
  })

  it('should start the OAuth process', async function() {
    const res = await got(`${baseUri}/github-auth`, { followRedirect: false })

    expect(res.statusCode).to.equal(302)

    const qs = queryString.stringify({
      client_id: fakeClientId,
      redirect_uri: 'https://img.shields.io/github-auth/done',
    })
    const expectedLocationHeader = `https://github.com/login/oauth/authorize?${qs}`
    expect(res.headers.location).to.equal(expectedLocationHeader)
  })

  describe('Finishing the OAuth process', function() {
    context('no code is provided', function() {
      it('should return an error', async function() {
        const res = await got(`${baseUri}/github-auth/done`)
        expect(res.body).to.equal(
          'GitHub OAuth authentication failed to provide a code.'
        )
      })
    })

    const fakeCode = '123456789'
    const fakeAccessToken = 'abcdef'

    context('a code is provided', function() {
      let scope
      beforeEach(function() {
        nock.enableNetConnect(/127\.0\.0\.1/)

        scope = nock('https://github.com')
          .post('/login/oauth/access_token')
          .reply((url, requestBody) => {
            expect(queryString.parse(requestBody).code).to.equal(fakeCode)
            return queryString.stringify({ access_token: fakeAccessToken })
          })
      })

      afterEach(function() {
        if (scope) {
          scope.done()
          scope = null
        }
      })

      afterEach(function() {
        nock.enableNetConnect()
        nock.cleanAll()
      })

      it('should finish the OAuth process', async function() {
        const res = await got(`${baseUri}/github-auth/done`, {
          form: true,
          body: { code: fakeCode },
        })
        expect(res.body).to.startWith(
          '<p>Shields.io has received your app-specific GitHub user token.'
        )
      })
    })
  })
})
