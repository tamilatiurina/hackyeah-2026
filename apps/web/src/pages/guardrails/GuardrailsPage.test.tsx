import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const card = (name: string) => screen.getByRole('article', { name })

describe('GuardrailsPage', () => {
  it('shows each guardrail with its engine, stage and action', async () => {
    renderApp('/guardrails')
    await screen.findByRole('article', { name: 'PII redaction' })
    const pii = within(card('PII redaction'))
    expect(pii.getByText('Open-source library')).toBeInTheDocument()
    expect(pii.getByText('Output')).toBeInTheDocument()
    expect(pii.getByText('Redact')).toBeInTheDocument()
    expect(pii.getByText(/masks them/)).toBeInTheDocument()
    expect(within(card('Toxicity filter')).getByText('Both')).toBeInTheDocument()
    expect(within(card('Toxicity filter')).getByText('Moderation API')).toBeInTheDocument()
  })

  it('disables and re-enables a guardrail', async () => {
    const user = userEvent.setup()
    renderApp('/guardrails')
    await screen.findByRole('article', { name: 'PII redaction' })
    await user.click(within(card('PII redaction')).getByRole('button', { name: 'Enabled' }))
    const toggle = await within(card('PII redaction')).findByRole('button', { name: 'Disabled' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(fakeApi.guardrails.find((g) => g.id === 'gr-pii')?.enabled).toBe(false)
  })

  it('asks for confirmation before deleting', async () => {
    const user = userEvent.setup()
    renderApp('/guardrails')
    await screen.findByRole('article', { name: 'PII redaction' })
    await user.click(within(card('PII redaction')).getByRole('button', { name: 'Delete' }))
    expect(card('PII redaction')).toBeInTheDocument()
    await user.click(within(card('PII redaction')).getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(screen.queryByRole('article', { name: 'PII redaction' })).not.toBeInTheDocument())
    expect(fakeApi.guardrails.map((g) => g.id)).toEqual(['gr-injection', 'gr-toxicity'])
  })

  it('cancels a pending delete when focus moves away', async () => {
    const user = userEvent.setup()
    renderApp('/guardrails')
    await screen.findByRole('article', { name: 'PII redaction' })
    await user.click(within(card('PII redaction')).getByRole('button', { name: 'Delete' }))
    await user.tab()
    expect(within(card('PII redaction')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('offers New guardrail only once templates and guardrails have loaded', async () => {
    server.use(
      http.get(apiPath('/guardrails'), async () => {
        await delay(150)
        return HttpResponse.json(fakeApi.guardrails)
      }),
    )
    renderApp('/guardrails')
    expect(screen.queryByRole('button', { name: 'New guardrail' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'New guardrail' })).toBeInTheDocument()
  })

  it('explains how to start the API when loading fails, and retries', async () => {
    const user = userEvent.setup()
    server.use(http.get(apiPath('/guardrails'), () => new HttpResponse(null, { status: 502 }), { once: true }))
    renderApp('/guardrails')
    expect(await screen.findByText("Couldn't load guardrails.")).toBeInTheDocument()
    expect(screen.getByText(/make api/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('article', { name: 'PII redaction' })).toBeInTheDocument()
  })
})
