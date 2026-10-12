import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'

const menuButton = () => screen.getByRole('button', { name: 'Menu' })
const sidebar = () => document.getElementById('app-sidebar')

async function openMenu() {
  const user = userEvent.setup()
  renderApp('/sessions')
  await user.click(menuButton())
  expect(menuButton()).toHaveAttribute('aria-expanded', 'true')
  expect(sidebar()).toHaveAttribute('data-open', 'true')
  return user
}

function expectClosed() {
  expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
  expect(sidebar()).toHaveAttribute('data-open', 'false')
  expect(screen.queryByRole('button', { name: 'Close menu' })).not.toBeInTheDocument()
}

describe('phone drawer', () => {
  it('starts closed', () => {
    renderApp('/sessions')
    expectClosed()
  })

  it('closes on Escape', async () => {
    const user = await openMenu()
    await user.keyboard('{Escape}')
    expectClosed()
  })

  it('closes when a nav item is picked', async () => {
    const user = await openMenu()
    await user.click(screen.getByRole('link', { name: 'Guardrails' }))
    expectClosed()
    expect(screen.getByRole('heading', { level: 1, name: 'Guardrails' })).toBeInTheDocument()
  })

  it('closes when the backdrop is clicked', async () => {
    const user = await openMenu()
    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    expectClosed()
  })

  it('moves focus to the first nav link when opened', async () => {
    await openMenu()
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveFocus()
  })

  it('returns focus to the Menu button after Escape', async () => {
    const user = await openMenu()
    await user.keyboard('{Escape}')
    expect(menuButton()).toHaveFocus()
  })

  it('returns focus to the Menu button after a backdrop click', async () => {
    const user = await openMenu()
    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(menuButton()).toHaveFocus()
  })

  it('toggles closed with the Menu button', async () => {
    const user = await openMenu()
    await user.click(menuButton())
    expectClosed()
  })
})
