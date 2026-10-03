import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Placeholder } from './Placeholder'

describe('Placeholder', () => {
  it('shows the page title and the issue that will fill it', () => {
    render(<Placeholder title="Sessions" issue="D-06" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Sessions' })).toBeInTheDocument()
    expect(screen.getByText('Coming in D-06.')).toBeInTheDocument()
  })
})
