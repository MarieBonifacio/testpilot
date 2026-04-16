/**
 * CMT Generator v3 — Générateur de documents Word formatés
 * =========================================================
 * Utilise la bibliothèque docx pour générer des documents
 * aux couleurs et styles CMT.
 * 
 * Couleurs par filiale :
 * - cmt-groupe    : #003DA5 (bleu)
 * - cmt-services  : #FF6B00 (orange)
 * - cmt-genie-electrique : #FFD700 (doré)
 * - cmt-genie-climatique : #00B894 (vert)
 * - cmt-batiment  : #6C5CE7 (violet)
 */

const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, HeadingLevel, PageOrientation, Media } = require('docx');
const fs = require('fs');
const path = require('path');

/**
 * Couleurs des filiales
 */
const FILIALE_COLORS = {
  'cmt-groupe': { primary: '003DA5', secondary: '00A3E0', accent: 'FF6B00', text: '333333' },
  'cmt-services': { primary: 'FF6B00', secondary: 'FF9E40', accent: '003DA5', text: '333333' },
  'cmt-genie-electrique': { primary: 'FFD700', secondary: 'FFE44D', accent: '003DA5', text: '333333' },
  'cmt-genie-climatique': { primary: '00B894', secondary: '55EFC4', accent: '003DA5', text: '333333' },
  'cmt-batiment': { primary: '6C5CE7', secondary: 'A29BFE', accent: 'FF6B00', text: '333333' },
};

const DEFAULT_COLORS = FILIALE_COLORS['cmt-groupe'];

/**
 * Helpers pour créer le contenu
 */
const content = {
  /**
   * Créer un paragraphe avec styles
   */
  p: (text, opts = {}) => {
    const { bold = false, italic = false, size = 22, color = null, align = 'left', spacing = 200, indent = 0 } = opts;
    return new Paragraph({
      spacing: { line: spacing, before: 0, after: spacing },
      indent: { left: indent * 240 },
      alignment: align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [
        new TextRun({
          text,
          bold,
          italic,
          size: size * 2, // docx utilise demi-points
          color: color || DEFAULT_COLORS.text,
          font: 'Calibri',
        }),
      ],
    });
  },

  /**
   * Créer un titre (level 1-5)
   */
  h: (text, level = 1, opts = {}) => {
    const { color = null, align = 'left', spacing = 400 } = opts;
    const colors = DEFAULT_COLORS;
    return new Paragraph({
      text,
      heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : level === 3 ? HeadingLevel.HEADING_3 : level === 4 ? HeadingLevel.HEADING_4 : HeadingLevel.HEADING_5,
      spacing: { before: spacing, after: 200, line: 300 },
      alignment: align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [
        new TextRun({
          text,
          bold: true,
          size: (28 - level * 2) * 2,
          color: color || colors.primary,
          font: 'Calibri',
        }),
      ],
    });
  },

  /**
   * Créer un élément de liste
   */
  bullet: (text, indent = 0, opts = {}) => {
    const { bold = false, size = 22, color = null } = opts;
    return new Paragraph({
      text: text,
      bullet: { level: indent },
      spacing: { line: 200, before: 50, after: 50 },
      indent: { left: (indent * 720) + 720 },
      children: [
        new TextRun({
          text,
          bold,
          size: size * 2,
          color: color || DEFAULT_COLORS.text,
        }),
      ],
    });
  },

  /**
   * Ligne vide
   */
  vide: (height = 200) => {
    return new Paragraph({
      spacing: { before: height, after: height },
      children: [],
    });
  },

  /**
   * Saut de page
   */
  sautPage: () => {
    return new Paragraph({
      break: 1,
      children: [],
    });
  },

  /**
   * Paragraphe avec style custom
   */
  custom: (children, opts = {}) => {
    const { align = 'left', spacing = 200, indent = 0, borderBottom = null } = opts;
    return new Paragraph({
      children,
      alignment: align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { line: spacing, before: spacing / 2, after: spacing / 2 },
      indent: { left: indent * 240 },
      border: borderBottom ? {
        bottom: { color: borderBottom, space: 6, value: borderBottom === 'split' ? 'single' : 'single', size: 6 },
      } : undefined,
    });
  },
};

/**
 * Helpers pour créer des tables
 */
const tables = {
  /**
   * Créer une table avec styles
   */
  makeTable: (rows, opts = {}) => {
    const { headerBg = DEFAULT_COLORS.primary, headerColor = 'FFFFFF', borderColor = 'CCCCCC', widths = null } = opts;
    
    const tableRows = rows.map((row, rowIdx) => {
      const cells = row.map((cell, cellIdx) => {
        const isHeader = rowIdx === 0;
        const bg = isHeader ? headerBg : 'FFFFFF';
        const color = isHeader ? headerColor : DEFAULT_COLORS.text;
        const bold = isHeader;
        
        // Si cell est un objet avec propriétés
        if (typeof cell === 'object' && cell !== null && cell.text !== undefined) {
          return new TableCell({
            shading: { fill: bg },
            children: [
              new Paragraph({
                alignment: cell.align || (isHeader ? AlignmentType.CENTER : AlignmentType.LEFT),
                children: [
                  new TextRun({
                    text: cell.text || '',
                    bold: cell.bold !== undefined ? cell.bold : bold,
                    size: (cell.size || 20) * 2,
                    color: cell.color || color,
                  }),
                ],
              }),
            ],
            width: { size: widths ? widths[cellIdx] / 100 : null, type: WidthType.PERCENTAGE },
          });
        }
        
        // Sinon, traitement simple
        const text = String(cell || '');
        return new TableCell({
          shading: { fill: bg },
          children: [
            new Paragraph({
              alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
              children: [
                new TextRun({
                  text,
                  bold,
                  size: 20 * 2,
                  color,
                }),
              ],
            }),
          ],
          width: { size: widths ? widths[cellIdx] / 100 : null, type: WidthType.PERCENTAGE },
        });
      });
      
      return new TableRow({
        children: cells,
      });
    });
    
    return new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      style: 'TableGrid',
    });
  },

  /**
   * Créer un tableau simple sans header
   */
  simpleTable: (data, opts = {}) => {
    const { columnWidths = null } = opts;
    const rows = data.map(row => 
      row.map(cell => 
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: String(cell || ''),
                  size: 20 * 2,
                  color: DEFAULT_COLORS.text,
                }),
              ],
            }),
          ],
        })
      )
    );
    
    return new Table({
      rows: rows.map(r => new TableRow({ children: r })),
      width: { size: 100, type: WidthType.PERCENTAGE },
    });
  },
};

/**
 * Génère un document mémoire (cahier de recette, rapport, plan de test)
 * @param {Object} vars - Variables du template
 * @param {Object} opts - Options (logosDir, ...)
 */
async function generateMemoire(vars, opts = {}) {
  const { logosDir = './logos' } = opts;
  const colors = FILIALE_COLORS[vars.filiale] || DEFAULT_COLORS;
  
  // Préparer les sections
  const children = [];
  
  // ============ PAGE DE GARDE ============
  children.push(content.vide(1200));
  children.push(content.vide(800));
  
  // Logo CMT (si présent)
  const logoPath = path.join(logosDir, `${vars.filiale || 'cmt-groupe'}.png`);
  if (fs.existsSync(logoPath)) {
    const logoImage = fs.readFileSync(logoPath);
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: '[LOGO ' + (vars.filiale || 'CMT GROUPE') + ']',
          bold: true,
          size: 36 * 2,
          color: colors.primary,
        }),
      ],
    }));
  }
  
  children.push(content.vide(600));
  
  // Titre principal
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: vars.projectTitle || vars.documentType.toUpperCase(),
        bold: true,
        size: 44 * 2,
        color: colors.primary,
      }),
    ],
  }));
  
  children.push(content.vide(400));
  
  // Sous-titre
  if (vars.projectReference) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: vars.projectReference,
          size: 28 * 2,
          color: colors.secondary,
        }),
      ],
    }));
  }
  
  children.push(content.vide(800));
  
  // Date de génération
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: 'Généré le ' + (vars.generationDate || new Date().toLocaleDateString('fr-FR')),
        italic: true,
        size: 20 * 2,
        color: colors.text,
      }),
    ],
  }));
  
  // Société
  if (vars.companyName) {
    children.push(content.vide(400));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: vars.companyName,
          size: 22 * 2,
          color: colors.text,
        }),
      ],
    }));
    if (vars.companyAddress) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: vars.companyAddress + (vars.companyPostalCode ? ', ' + vars.companyPostalCode : '') + (vars.companyCity ? ' ' + vars.companyCity : ''),
            size: 18 * 2,
            color: colors.text,
          }),
        ],
      }));
    }
  }
  
  // Saut de page après page de garde
  children.push(new Paragraph({ break: 1 }));
  
  // ============ SOMMAIRE ============
  children.push(content.h('Table des matières', 1));
  children.push(content.vide());
  
  if (vars.sections) {
    vars.sections.forEach((section, idx) => {
      const indent = (section.level - 1) * 2;
      children.push(content.bullet((section.level === 1 ? '' : '  '.repeat(section.level - 1)) + section.title, indent));
    });
  }
  
  children.push(new Paragraph({ break: 1 }));
  
  // ============ SECTIONS ============
  if (vars.sections) {
    for (const section of vars.sections) {
      // Titre de section
      children.push(content.h(section.title, section.level || 2));
      
      // Contenu texte
      if (section.content) {
        const lines = section.content.split('\n').filter(l => l.trim());
        for (const line of lines) {
          // Remplacer les placeholders {{table}}
          if (line.includes('{{coverage_table}}') || line.includes('{{results_table}}')) {
            // Les tables seront générées séparément
            continue;
          }
          children.push(content.p(line.trim()));
        }
      }
      
      // Sous-sections
      if (section.subsections) {
        for (const sub of section.subsections) {
          children.push(content.h(sub.title, sub.level || 4));
          if (sub.content) {
            const lines = sub.content.split('\n').filter(l => l.trim());
            for (const line of lines) {
              if (line.startsWith('-')) {
                children.push(content.bullet(line.substring(1).trim()));
              } else if (line.includes(':')) {
                const [key, val] = line.split(':').map(s => s.trim());
                children.push(new Paragraph({
                  children: [
                    new TextRun({ text: key + ' : ', bold: true, size: 20 * 2, color: colors.text }),
                    new TextRun({ text: val, size: 20 * 2, color: colors.text }),
                  ],
                }));
              } else {
                children.push(content.p(line.trim()));
              }
            }
          }
        }
      }
      
      children.push(content.vide());
    }
  }
  
  // ============ CRÉER LE DOCUMENT ============
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          orientation: PageOrientation.PORTRAIT,
          margin: { top: 2000, right: 1500, bottom: 1500, left: 1500 },
        },
      },
      children,
    }],
    styles: {
      defaultFont: {
        name: 'Calibri',
        size: 22,
      },
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          run: {
            font: 'Calibri',
            size: 22,
          },
        },
      ],
    },
  });
  
  // Générer le buffer
  return Packer.toBuffer(doc);
}

/**
 * Génère un document simple sans structure complexe
 */
async function generateSimple(title, data) {
  const children = [];
  
  children.push(content.h(title, 1));
  children.push(content.vide());
  
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string') {
        children.push(content.p(item));
      } else if (Array.isArray(item)) {
        children.push(tables.simpleTable([item]));
      }
    }
  }
  
  const doc = new Document({
    sections: [{
      children,
    }],
  });
  
  return Packer.toBuffer(doc);
}

module.exports = {
  generateMemoire,
  generateSimple,
  content,
  tables,
  FILIALE_COLORS,
  DEFAULT_COLORS,
};
