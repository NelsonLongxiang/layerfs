DELETE FROM branch WHERE branch_id = $1 AND layer_stack_id = $2 RETURNING 1;
