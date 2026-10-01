import { describe, expect, it } from 'vitest'
import { formatAmountInput, parseAmountInput, tidyAmountInput } from './amounts'

describe('saisie des montants', () => {
  it('accepte les raccourcis k et M', () => {
    expect(['120k', '120 k', '120K', '120k€', '120 k€'].map(parseAmountInput)).toEqual([120000, 120000, 120000, 120000, 120000])
    expect(['1,2M', '1.2m', '1,2 M€'].map(parseAmountInput)).toEqual([1200000, 1200000, 1200000])
    expect(parseAmountInput('1,5k')).toBe(1500)
    expect(parseAmountInput('2,75k')).toBe(2750)
  })

  it('accepte les espaces, les points des milliers et les décimales', () => {
    expect(parseAmountInput('120000')).toBe(120000)
    expect(parseAmountInput('120 000 €')).toBe(120000)
    expect(parseAmountInput('120 000')).toBe(120000)
    expect(parseAmountInput('120.000')).toBe(120000)
    expect(parseAmountInput('1.200.000')).toBe(1200000)
    expect(parseAmountInput('120 000,50')).toBe(120000.5)
    expect(parseAmountInput('0,5')).toBe(0.5)
    expect(parseAmountInput('-5k')).toBe(-5000)
  })

  it('vide → null, illisible → NaN', () => {
    expect(parseAmountInput('')).toBeNull()
    expect(parseAmountInput('  ')).toBeNull()
    expect(['abc', '12k5', '1,2,3', 'k'].map(parseAmountInput).every(Number.isNaN)).toBe(true)
  })

  it('remet en forme en quittant le champ', () => {
    const sp = ' '
    expect(formatAmountInput(120000)).toBe(`120${sp}000`)
    expect(tidyAmountInput('120k')).toBe(`120${sp}000`)
    expect(tidyAmountInput('1,2M')).toBe(`1${sp}200${sp}000`)
    expect(tidyAmountInput('2,5')).toBe('2,5')
    expect(tidyAmountInput('   ')).toBe('')
    expect(tidyAmountInput('12k5')).toBe('12k5')
  })
})
