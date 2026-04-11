/**
 * BacklinkNodes — mini map-style nodes showing fibers that link TO this fiber.
 *
 * Positioned in the right margin at the top of the prose wrapper, beside the
 * fiber title. Scrolls out of view with the header.
 */

import type { GraphNode } from '~/utils/content-types';

const STATUS_COLOR: Record<string, string> = {
  open: 'var(--gold)',
  active: 'var(--teal)',
  closed: 'var(--teal)',
  resolved: 'var(--teal)',
  suspicious: 'var(--amber)',
  blocked: 'var(--mauve)',
};

interface BacklinkNodesProps {
  nodes: GraphNode[];
  navigate: (slug: string) => void;
}

export function BacklinkNodes({ nodes, navigate }: BacklinkNodesProps) {
  if (nodes.length === 0) return null;

  return (
    <div className="backlink-nodes" aria-label="Fibers that reference this one">
      {nodes.map((node) => {
        const color = STATUS_COLOR[node.status] ?? 'var(--text-muted)';
        return (
          <button
            key={node.id}
            className="backlink-node"
            title={node.label}
            onClick={() => navigate(`/${node.slug}`)}
            aria-label={`Referenced by: ${node.label}`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              {/* Outer ring */}
              <ellipse
                cx="8" cy="8" rx="7" ry="6.5"
                fill="none"
                stroke={color}
                strokeWidth="1"
                opacity="0.35"
              />
              {/* Inner filled ellipse */}
              <ellipse
                cx="8" cy="8" rx="4.5" ry="4"
                fill={color}
                opacity="0.6"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
