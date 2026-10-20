import { type Project } from './model';
// A file may only advertise a result for exactly its own current physical input.
export function persistable(project: Project, result: any, resultSignature: string) {
  const fresh = !!result && JSON.stringify(project.model) === resultSignature;
  return {
    ...project,
    result_metadata: fresh
      ? {
          input_hash: result.input_hash,
          job_id: result.job_id,
          status: result.status,
          algorithm: result.algorithm,
          version: result.version,
          calculated_at: result.calculated_at,
          residuals: result.residuals,
          fluid: result.fluid,
        }
      : undefined,
  };
}
