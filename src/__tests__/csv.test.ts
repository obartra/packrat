import { describe, it, expect } from 'vitest';
import { parseCSV, parseCSVLine } from '../csv';

describe('parseCSVLine', () => {
  it('splits a simple comma-separated line', () => {
    expect(parseCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields with embedded commas', () => {
    expect(parseCSVLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });

  it('handles escaped double-quotes within quoted fields', () => {
    expect(parseCSVLine('a,"b""c",d')).toEqual(['a', 'b"c', 'd']);
  });

  it('handles empty fields', () => {
    expect(parseCSVLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('handles a trailing empty field', () => {
    expect(parseCSVLine('a,b,')).toEqual(['a', 'b', '']);
  });

  it('handles a quoted field with only whitespace', () => {
    expect(parseCSVLine('a,"   ",b')).toEqual(['a', '   ', 'b']);
  });

  it('handles a single unquoted field', () => {
    expect(parseCSVLine('hello')).toEqual(['hello']);
  });
});

describe('parseCSV', () => {
  it('parses a header + single row', () => {
    const text = 'name,qty\nShirt,3';
    expect(parseCSV(text)).toEqual([{ name: 'Shirt', qty: '3' }]);
  });

  it('lowercases and trims header names', () => {
    const text = ' Name , Qty \nShirt,3';
    expect(parseCSV(text)).toEqual([{ name: 'Shirt', qty: '3' }]);
  });

  it('returns [] when fewer than 2 lines', () => {
    expect(parseCSV('')).toEqual([]);
    expect(parseCSV('name,qty')).toEqual([]);
  });

  it('filters out rows missing the name field', () => {
    const text = 'name,qty\nShirt,3\n,5\nPants,2';
    expect(parseCSV(text)).toEqual([
      { name: 'Shirt', qty: '3' },
      { name: 'Pants', qty: '2' },
    ]);
  });

  it('handles CRLF line endings', () => {
    const text = 'name,qty\r\nShirt,3\r\nPants,2';
    expect(parseCSV(text)).toEqual([
      { name: 'Shirt', qty: '3' },
      { name: 'Pants', qty: '2' },
    ]);
  });

  it('handles quoted fields containing commas across multiple rows', () => {
    const text = 'name,tags\n"Black shirt","merino,warm"\n"Red pants","summer,linen"';
    expect(parseCSV(text)).toEqual([
      { name: 'Black shirt', tags: 'merino,warm' },
      { name: 'Red pants', tags: 'summer,linen' },
    ]);
  });

  it('leaves missing trailing columns as empty strings', () => {
    const text = 'name,a,b,c\nShirt,1,2';
    expect(parseCSV(text)).toEqual([{ name: 'Shirt', a: '1', b: '2', c: '' }]);
  });

  it('handles the example CSV from design.md', () => {
    const text =
      'name,category_group,category_value,quantity_owned,quantity_pack_default,container_name,tags,notes\n' +
      '"Black merino t-shirt",clothing,tops,3,2,"Osprey carry-on","merino,warm weather",""';
    const rows = parseCSV(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Black merino t-shirt',
      category_group: 'clothing',
      category_value: 'tops',
      quantity_owned: '3',
      quantity_pack_default: '2',
      container_name: 'Osprey carry-on',
      tags: 'merino,warm weather',
      notes: '',
    });
  });

  it('parses description and color columns', () => {
    const text =
      'name,category_group,category_value,quantity_owned,quantity_pack_default,container_name,tags,notes,description,color\n' +
      '"Navy polo shirt",clothing,tops,1,1,"",casual,"","Lightweight cotton polo",#1B3A5C';
    const rows = parseCSV(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Navy polo shirt',
      description: 'Lightweight cotton polo',
      color: '#1B3A5C',
    });
  });

  it('handles missing description and color columns gracefully', () => {
    const text = 'name,category_group,category_value\n' + 'Socks,clothing,socks';
    const rows = parseCSV(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBeUndefined();
    expect(rows[0]!.color).toBeUndefined();
  });
});
