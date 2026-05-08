import { PipelineStage, Types } from 'mongoose';

export enum Collections {
  courses = 'courses',
  lessons = 'lessons',
  lessonContain = 'lesson_contain',
  courseIntroduction = 'course_introduction',
  courseCategories = 'course_categories',
}

const foreignFieldMap: Record<Collections, string> = {
  [Collections.courses]: 'course_categories_id',
  [Collections.lessons]: 'course_id',
  [Collections.lessonContain]: 'lesson_id',
  [Collections.courseIntroduction]: 'course_id',
  [Collections.courseCategories]: '',
};

function getForeignField(collection: Collections): string {
  return foreignFieldMap[collection] || '';
}

export function includeHandle(
  inc: Collections,
  id?: string,
  slug?: string,
  course_id?: string,
): PipelineStage[] {
  const pipeline: PipelineStage[] = [];

  if (id) {
    pipeline.push({
      $match: {
        _id: new Types.ObjectId(id),
      },
    });
  }

  if (slug) {
    pipeline.push({
      $match: {
        slug: slug,
      },
    });
  }

  if (course_id) {
    pipeline.push({
      $match: {
        course_id: new Types.ObjectId(course_id),
      },
    });
  }

  pipeline.push({
    $lookup: {
      from: inc,
      localField: '_id',
      foreignField: getForeignField(inc),
      as: inc,
    },
  });

  return pipeline;
}

export function checkCollections(value: unknown): value is Collections {
  return Object.values(Collections).includes(value as Collections);
}
